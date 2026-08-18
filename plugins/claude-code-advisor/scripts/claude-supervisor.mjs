#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  supervisorPaths,
  transitionSupervisedJob,
  updateSupervisedCleanup,
  validateSupervisedClaudeResult
} from "./lib/runtime.mjs";

const CONFIG_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTROL_LIMIT_BYTES = 4096;
const GROUP_VERIFY_MS = 1000;
const PROVIDER_START_TIMEOUT_MS = 5000;
const groupWorkerScript = fileURLToPath(new URL("./claude-group-worker.mjs", import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readConfig() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > CONFIG_LIMIT_BYTES) throw new Error("invalid-supervisor-config");
    chunks.push(Buffer.from(chunk));
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid-supervisor-config");
  }
  if (
    !parsed ||
    typeof parsed.jobId !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.prompt !== "string" ||
    !parsed.prompt.trim() ||
    !Array.isArray(parsed.claudeArgs) ||
    parsed.claudeArgs.some((value) => typeof value !== "string") ||
    typeof parsed.cwd !== "string" ||
    typeof parsed.stateDir !== "string" ||
    typeof parsed.stateRoot !== "string"
  ) throw new Error("invalid-supervisor-config");
  return parsed;
}

function transition(config, transitionSpec) {
  return transitionSupervisedJob(config.stateDir, config.jobId, transitionSpec, { pathBoundary: config.stateRoot });
}

function groupExists(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 0 || process.platform === "win32") return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForGroupGone(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pgid)) return true;
    await delay(20);
  }
  return !groupExists(pgid);
}

async function terminateOwnedGroup(worker, closePromise) {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null || !worker.connected) return false;
  const requested = await new Promise((resolve) => {
    worker.send({ type: "terminate" }, (error) => resolve(!error));
  });
  if (!requested) return false;
  const closed = await Promise.race([
    closePromise.then(() => true),
    delay(2000).then(() => false)
  ]);
  if (!closed) return false;
  return waitForGroupGone(worker.pid, GROUP_VERIFY_MS);
}

function createPrivateControlDirectory(directory) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("control-resource-failure");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("control-resource-failure");
  fs.chmodSync(directory, 0o700);
}

async function main() {
  const config = await readConfig();
  if (process.platform !== "darwin") {
    transition(config, {
      expectedStates: ["starting"],
      toState: "failed",
      patch: {
        failureClassification: "unsupported-platform",
        cleanupStatus: "verified",
        terminalAt: new Date().toISOString()
      }
    });
    process.send?.({ type: "failed", classification: "unsupported-platform" });
    process.disconnect?.();
    return;
  }

  const control = supervisorPaths(config.stateDir, config.jobId);
  createPrivateControlDirectory(control.directory);
  let child = null;
  let controlServer = null;
  let cancellationRequested = false;
  let interruptionRequested = false;
  let failureClassification = null;
  let finalising = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutChunks = [];
  let workerClosePromise = null;
  let terminationPromise = null;

  const cleanControlResources = async () => {
    let resourceCleanup = true;
    try {
      const listeningStat = fs.lstatSync(control.socket);
      if (!listeningStat.isSocket()) throw new Error("control-resource-failure");
      await new Promise((resolve) => controlServer.close(resolve));
      try {
        const remainingStat = fs.lstatSync(control.socket);
        if (!remainingStat.isSocket()) throw new Error("control-resource-failure");
        fs.unlinkSync(control.socket);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      fs.rmdirSync(control.directory);
    } catch {
      resourceCleanup = false;
    }
    return resourceCleanup;
  };

  const stdoutLimit = Number(config.stdoutLimitBytes);
  const stderrLimit = Number(config.stderrLimitBytes);
  const timeoutMs = Number(config.timeoutMs);

  const ensureGroupTermination = () => {
    if (child && workerClosePromise && !terminationPromise) {
      terminationPromise = terminateOwnedGroup(child, workerClosePromise);
    }
    return terminationPromise;
  };
  const requestTermination = (classification, interrupted = false) => {
    if (!failureClassification) failureClassification = classification;
    if (interrupted) interruptionRequested = true;
    return ensureGroupTermination();
  };

  const handleControl = (socket) => {
    let bytes = 0;
    const chunks = [];
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > CONTROL_LIMIT_BYTES) socket.destroy();
      else chunks.push(Buffer.from(chunk));
    });
    socket.on("end", () => {
      let request;
      try {
        request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        socket.end('{"ok":false}\n');
        return;
      }
      if (request?.token !== config.token) {
        socket.end('{"ok":false}\n');
        return;
      }
      if (request.command === "ping") {
        socket.end('{"ok":true,"state":"running"}\n');
        return;
      }
      if (request.command !== "cancel") {
        socket.end('{"ok":false}\n');
        return;
      }
      cancellationRequested = true;
      requestTermination("cancellation");
      try {
        transition(config, {
          expectedStates: ["starting", "running"],
          toState: "cancelling",
          patch: { cancelRequestedAt: new Date().toISOString() }
        });
      } catch {
        // The already-requested owned-group termination continues. Its single
        // terminal closer retries state persistence after lock contention.
      }
      socket.end('{"ok":true}\n');
    });
  };

  controlServer = net.createServer(handleControl);
  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(control.socket, () => {
      controlServer.off("error", reject);
      resolve();
    });
  });

  child = spawn(process.execPath, [groupWorkerScript], {
    cwd: config.cwd,
    env: process.env,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe", "ipc"]
  });

  child.stdout.on("data", (chunk) => {
    if (failureClassification) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > stdoutLimit) {
      stdoutChunks = [];
      requestTermination("output-limit");
      return;
    }
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > stderrLimit) requestTermination("output-limit");
  });
  child.once("error", () => requestTermination("spawn-failure"));

  workerClosePromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  let resolveProviderReady;
  let resolveProviderOutcome;
  const providerReadyPromise = new Promise((resolve) => { resolveProviderReady = resolve; });
  const providerOutcomePromise = new Promise((resolve) => { resolveProviderOutcome = resolve; });
  child.on("message", (message) => {
    if (message?.type === "provider-ready") resolveProviderReady({ ok: true });
    if (message?.type === "provider-spawn-error") resolveProviderOutcome({ kind: "spawn-error" });
    if (message?.type === "provider-close") {
      resolveProviderOutcome({ kind: "close", code: message.code, signal: message.signal });
    }
  });
  const spawnPromise = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  try {
    await spawnPromise;
  } catch {
    const terminal = transition(config, {
      expectedStates: ["starting", "cancelling"],
      toState: cancellationRequested ? "cancelled" : "failed",
      patch: {
        failureClassification: cancellationRequested ? "cancellation" : "spawn-failure",
        cleanupStatus: "pending",
        terminalAt: new Date().toISOString()
      }
    });
    const resourceCleanup = await cleanControlResources();
    if (terminal.applied) {
      updateSupervisedCleanup(config.stateDir, config.jobId, resourceCleanup ? "verified" : "failed", {
        pathBoundary: config.stateRoot
      });
    }
    process.send?.({ type: "failed", classification: cancellationRequested ? "cancellation" : "spawn-failure" });
    process.disconnect?.();
    if (!resourceCleanup) process.exitCode = 1;
    return;
  }
  child.stdin.end(JSON.stringify({ claudeArgs: config.claudeArgs, prompt: config.prompt, cwd: config.cwd }));
  const providerStart = await Promise.race([
    providerReadyPromise,
    providerOutcomePromise,
    delay(PROVIDER_START_TIMEOUT_MS).then(() => ({ kind: "start-timeout" }))
  ]);
  if (providerStart?.ok !== true) {
    failureClassification = providerStart?.kind === "spawn-error" ? "spawn-failure" : "worker-failure";
    const groupClean = await (requestTermination(failureClassification) || Promise.resolve(false));
    const terminal = transition(config, {
      expectedStates: ["starting", "cancelling"],
      toState: "failed",
      patch: {
        failureClassification,
        cleanupStatus: groupClean ? "pending" : "failed",
        terminalAt: new Date().toISOString()
      }
    });
    if (terminal.applied && groupClean) {
      const resourceCleanup = await cleanControlResources();
      updateSupervisedCleanup(config.stateDir, config.jobId, resourceCleanup ? "verified" : "failed", {
        pathBoundary: config.stateRoot
      });
    }
    process.send?.({ type: "failed", classification: failureClassification });
    process.disconnect?.();
    return;
  }
  if (cancellationRequested) requestTermination("cancellation");
  const running = transition(config, {
    expectedStates: ["starting"],
    toState: "running",
    patch: {
      runningAt: new Date().toISOString(),
      launchAcknowledgedAt: new Date().toISOString(),
      supervisor: { pid: process.pid, token: config.token }
    }
  });
  if (!running.applied && running.job?.lifecycleState !== "cancelling") {
    requestTermination("interrupted-supervisor", true);
  }

  process.send?.({ type: "ready" });
  process.disconnect?.();

  const timeout = setTimeout(() => requestTermination("timeout"), timeoutMs);
  timeout.unref();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => requestTermination("interrupted-supervisor", true));
  }

  const completion = await Promise.race([
    providerOutcomePromise.then((outcome) => ({ source: "provider", outcome })),
    workerClosePromise.then((outcome) => ({ source: "worker", outcome }))
  ]);
  clearTimeout(timeout);
  if (finalising) return;
  finalising = true;

  let outcome = completion.outcome;
  let groupClean;
  if (completion.source === "provider") {
    if (outcome.kind === "spawn-error" && !failureClassification) failureClassification = "spawn-failure";
    groupClean = await (ensureGroupTermination() || Promise.resolve(false));
  } else {
    if (!failureClassification) {
      failureClassification = "interrupted-supervisor";
      interruptionRequested = true;
    }
    groupClean = terminationPromise ? await terminationPromise : false;
    outcome = { code: null, signal: completion.outcome.signal };
  }
  let lifecycleState;
  let terminalPatch = {
    cleanupStatus: groupClean ? "pending" : "failed",
    terminalAt: new Date().toISOString()
  };
  if (cancellationRequested) {
    lifecycleState = groupClean ? "cancelled" : "failed";
    terminalPatch.failureClassification = groupClean ? "cancellation" : "cleanup-failure";
  } else if (interruptionRequested) {
    lifecycleState = "interrupted";
    terminalPatch.failureClassification = "interrupted-supervisor";
  } else if (failureClassification) {
    lifecycleState = "failed";
    terminalPatch.failureClassification = failureClassification;
  } else if (outcome.signal) {
    lifecycleState = "failed";
    terminalPatch.failureClassification = "signal-termination";
  } else if (outcome.code !== 0) {
    lifecycleState = "failed";
    terminalPatch.failureClassification = "non-zero-exit";
  } else {
    try {
      const validated = validateSupervisedClaudeResult(Buffer.concat(stdoutChunks), config.expectedSessionId || null);
      lifecycleState = "completed";
      terminalPatch = {
        ...terminalPatch,
        canonicalSessionId: validated.sessionId,
        resumeSessionId: validated.sessionId,
        result: validated.result,
        resultAuthoritativeAt: new Date().toISOString(),
        resultSource: "provider-json",
        resultState: "available"
      };
    } catch {
      lifecycleState = "failed";
      terminalPatch.failureClassification = "invalid-result";
    }
  }

  const terminal = transition(config, {
    expectedStates: ["starting", "running", "cancelling"],
    toState: lifecycleState,
    patch: terminalPatch
  });
  if (!terminal.applied || !groupClean) return;

  const resourceCleanup = await cleanControlResources();
  updateSupervisedCleanup(config.stateDir, config.jobId, resourceCleanup ? "verified" : "failed", {
    pathBoundary: config.stateRoot
  });
  if (!resourceCleanup) process.exitCode = 1;
}

main().catch(() => {
  process.send?.({ type: "failed", classification: "worker-failure" });
  process.disconnect?.();
  process.exitCode = 1;
});
