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
const GROUP_TERM_GRACE_MS = 500;
const CONTROL_CLOSE_MS = 1000;
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

function signalOwnedGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    return false;
  }
}

async function terminateOwnedGroup(worker, closePromise, exitPromise, ownedPgid) {
  if (!Number.isInteger(ownedPgid) || ownedPgid <= 0) return false;
  await Promise.race([exitPromise, delay(20)]);
  if (!groupExists(ownedPgid)) return true;

  if (worker && worker.exitCode === null && worker.signalCode === null && worker.connected) {
    const requested = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), GROUP_TERM_GRACE_MS);
      worker.send({ type: "terminate" }, (error) => {
        clearTimeout(timer);
        resolve(!error);
      });
    });
    if (requested) {
      await Promise.race([closePromise, delay(2000)]);
      if (await waitForGroupGone(ownedPgid, GROUP_VERIFY_MS)) return true;
    }
  }

  if (!groupExists(ownedPgid)) return true;
  if (!signalOwnedGroup(ownedPgid, "SIGTERM")) return false;
  if (await waitForGroupGone(ownedPgid, GROUP_TERM_GRACE_MS)) return true;
  if (!signalOwnedGroup(ownedPgid, "SIGKILL")) return false;
  await Promise.race([exitPromise, closePromise, delay(GROUP_VERIFY_MS)]);
  return waitForGroupGone(ownedPgid, GROUP_VERIFY_MS);
}

function createPrivateControlDirectory(directory, markOwned) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("control-resource-failure");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("control-resource-failure");
  markOwned();
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
  let child = null;
  let ownedPgid = null;
  let controlServer = null;
  let controlDirectoryOwned = false;
  const controlSockets = new Set();
  let controlCleanupPromise = null;
  let cancellationRequested = false;
  let interruptionRequested = false;
  let failureClassification = null;
  let finalising = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutChunks = [];
  let workerClosePromise = null;
  let workerExitPromise = null;
  let terminationPromise = null;
  let resolveInterruption;
  const interruptionPromise = new Promise((resolve) => { resolveInterruption = resolve; });
  let resolveTerminationRequest;
  const terminationRequestPromise = new Promise((resolve) => { resolveTerminationRequest = resolve; });

  const cleanControlResources = () => {
    if (controlCleanupPromise) return controlCleanupPromise;
    controlCleanupPromise = (async () => {
      let resourceCleanup = true;
      for (const socket of controlSockets) socket.destroy();
      controlSockets.clear();
      if (controlServer?.listening) {
        const closed = await Promise.race([
          new Promise((resolve) => controlServer.close(() => resolve(true))),
          delay(CONTROL_CLOSE_MS).then(() => false)
        ]);
        if (!closed) resourceCleanup = false;
      }
      try {
        const socketStat = fs.lstatSync(control.socket);
        if (!socketStat.isSocket()) {
          resourceCleanup = false;
        } else {
          fs.unlinkSync(control.socket);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") resourceCleanup = false;
      }
      if (controlDirectoryOwned) {
        try {
          const directoryStat = fs.lstatSync(control.directory);
          const owned = typeof process.getuid !== "function" || directoryStat.uid === process.getuid();
          if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || !owned) {
            resourceCleanup = false;
          } else {
            fs.rmdirSync(control.directory);
          }
        } catch (error) {
          if (error?.code !== "ENOENT") resourceCleanup = false;
        }
      }
      if (fs.existsSync(control.socket) || (controlDirectoryOwned && fs.existsSync(control.directory))) {
        resourceCleanup = false;
      }
      return resourceCleanup;
    })();
    return controlCleanupPromise;
  };

  const stdoutLimit = Number(config.stdoutLimitBytes);
  const stderrLimit = Number(config.stderrLimitBytes);
  const timeoutMs = Number(config.timeoutMs);

  const ensureGroupTermination = () => {
    if (ownedPgid && workerClosePromise && workerExitPromise && !terminationPromise) {
      terminationPromise = terminateOwnedGroup(child, workerClosePromise, workerExitPromise, ownedPgid);
    }
    return terminationPromise;
  };
  const requestTermination = (classification, interrupted = false) => {
    if (!failureClassification) failureClassification = classification;
    if (interrupted) {
      interruptionRequested = true;
      resolveInterruption({ kind: "supervisor-interruption" });
    }
    const requested = ensureGroupTermination();
    resolveTerminationRequest({ kind: "termination-request", classification });
    return requested;
  };
  const persistCleanupStatus = (terminal, groupClean, resourceCleanup) => {
    const cleanupStatus = groupClean && resourceCleanup ? "verified" : "failed";
    if (!terminal?.job || !["completed", "cancelled", "failed", "interrupted"].includes(terminal.job.lifecycleState)) {
      return false;
    }
    try {
      updateSupervisedCleanup(config.stateDir, config.jobId, cleanupStatus, { pathBoundary: config.stateRoot });
      return true;
    } catch {
      return false;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => requestTermination("interrupted-supervisor", true));
  }

  const handleControl = (socket) => {
    controlSockets.add(socket);
    socket.on("close", () => controlSockets.delete(socket));
    socket.on("error", () => {});
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

  try {
    createPrivateControlDirectory(control.directory, () => { controlDirectoryOwned = true; });
    controlServer = net.createServer(handleControl);
    await new Promise((resolve, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(control.socket, () => {
        controlServer.off("error", reject);
        resolve();
      });
    });
    controlServer.on("error", () => requestTermination("worker-failure"));
    if (interruptionRequested) throw new Error("supervisor-interrupted");

    child = spawn(process.execPath, [groupWorkerScript], {
      cwd: config.cwd,
      env: process.env,
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "ipc"]
    });
    ownedPgid = child.pid;

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
    workerExitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    let resolveWorkerLoss;
    let providerOutcomeDelivered = false;
    const workerLossPromise = new Promise((resolve) => { resolveWorkerLoss = resolve; });
    workerClosePromise.then((outcome) => {
      if (!providerOutcomeDelivered) resolveWorkerLoss({ kind: "worker-exit", ...outcome });
    });
    child.once("disconnect", () => {
      if (!providerOutcomeDelivered) resolveWorkerLoss({ kind: "ipc-disconnect" });
    });
    child.stdin.on("error", () => {
      if (!providerOutcomeDelivered) resolveWorkerLoss({ kind: "worker-stdin-error" });
    });
    let resolveProviderReady;
    let resolveProviderOutcome;
    const providerReadyPromise = new Promise((resolve) => { resolveProviderReady = resolve; });
    const providerOutcomePromise = new Promise((resolve) => { resolveProviderOutcome = resolve; });
    child.on("message", (message) => {
      if (message?.type === "provider-ready") resolveProviderReady({ ok: true });
      if (message?.type === "provider-spawn-error") {
        providerOutcomeDelivered = true;
        resolveProviderOutcome({ kind: "spawn-error" });
      }
      if (message?.type === "provider-close") {
        providerOutcomeDelivered = true;
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
      const groupClean = ownedPgid
        ? await (requestTermination("spawn-failure") || Promise.resolve(false))
        : true;
      const terminal = transition(config, {
        expectedStates: ["starting", "cancelling"],
        toState: cancellationRequested ? "cancelled" : "failed",
        patch: {
          failureClassification: cancellationRequested ? "cancellation" : "spawn-failure",
          cleanupStatus: groupClean ? "pending" : "failed",
          terminalAt: new Date().toISOString()
        }
      });
      const resourceCleanup = await cleanControlResources();
      const cleanupPersisted = persistCleanupStatus(terminal, groupClean, resourceCleanup);
      process.send?.({ type: "failed", classification: cancellationRequested ? "cancellation" : "spawn-failure" });
      process.disconnect?.();
      if (!groupClean || !resourceCleanup || !cleanupPersisted) process.exitCode = 1;
      return;
    }
    child.stdin.end(JSON.stringify({ claudeArgs: config.claudeArgs, prompt: config.prompt, cwd: config.cwd }));
    const providerStart = await Promise.race([
      providerReadyPromise,
      providerOutcomePromise,
      workerLossPromise,
      interruptionPromise,
      terminationRequestPromise,
      delay(PROVIDER_START_TIMEOUT_MS).then(() => ({ kind: "start-timeout" }))
    ]);
    if (providerStart?.ok !== true) {
      if (!failureClassification) {
        failureClassification = providerStart?.kind === "spawn-error"
          ? "spawn-failure"
          : providerStart?.kind === "supervisor-interruption"
            ? "interrupted-supervisor"
            : "worker-failure";
      }
      if (providerStart?.kind === "supervisor-interruption") interruptionRequested = true;
      const groupClean = await (requestTermination(failureClassification) || Promise.resolve(false));
      const lifecycleState = cancellationRequested
        ? groupClean ? "cancelled" : "failed"
        : interruptionRequested ? "interrupted" : "failed";
      const classification = cancellationRequested
        ? groupClean ? "cancellation" : "cleanup-failure"
        : failureClassification;
      const terminal = transition(config, {
        expectedStates: ["starting", "cancelling"],
        toState: lifecycleState,
        patch: {
          failureClassification: classification,
          cleanupStatus: groupClean ? "pending" : "failed",
          terminalAt: new Date().toISOString()
        }
      });
      const resourceCleanup = await cleanControlResources();
      const cleanupPersisted = persistCleanupStatus(terminal, groupClean, resourceCleanup);
      process.send?.({ type: "failed", classification: failureClassification });
      process.disconnect?.();
      if (!groupClean || !resourceCleanup || !cleanupPersisted) process.exitCode = 1;
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

    const completion = await Promise.race([
      providerOutcomePromise.then((outcome) => ({ source: "provider", outcome })),
      workerLossPromise.then((outcome) => ({ source: "worker", outcome })),
      interruptionPromise.then((outcome) => ({ source: "interruption", outcome })),
      terminationRequestPromise.then((outcome) => ({ source: "termination", outcome }))
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
      if (!failureClassification) failureClassification = completion.source === "worker"
        ? "worker-failure"
        : "interrupted-supervisor";
      if (completion.source === "interruption") interruptionRequested = true;
      groupClean = await (ensureGroupTermination() || Promise.resolve(false));
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
    const resourceCleanup = await cleanControlResources();
    const cleanupPersisted = persistCleanupStatus(terminal, groupClean, resourceCleanup);
    if (!groupClean || !resourceCleanup || !cleanupPersisted) process.exitCode = 1;

  } catch {
    const classification = interruptionRequested
      ? "interrupted-supervisor"
      : failureClassification || "worker-failure";
    const groupClean = ownedPgid && workerClosePromise
      ? await (requestTermination(classification, interruptionRequested) || Promise.resolve(false))
      : !ownedPgid;
    let terminal = null;
    try {
      terminal = transition(config, {
        expectedStates: ["starting", "running", "cancelling"],
        toState: interruptionRequested ? "interrupted" : "failed",
        patch: {
          failureClassification: classification,
          cleanupStatus: groupClean ? "pending" : "failed",
          terminalAt: new Date().toISOString()
        }
      });
    } catch {
      terminal = null;
    }
    const resourceCleanup = await cleanControlResources();
    const cleanupPersisted = persistCleanupStatus(terminal, groupClean, resourceCleanup);
    process.send?.({ type: "failed", classification });
    process.disconnect?.();
    if (!groupClean || !resourceCleanup || !cleanupPersisted) process.exitCode = 1;
  }
}

main().catch(() => {
  process.send?.({ type: "failed", classification: "worker-failure" });
  process.disconnect?.();
  process.exitCode = 1;
});
