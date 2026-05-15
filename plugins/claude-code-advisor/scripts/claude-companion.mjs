#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildBackgroundArgs,
  buildClaudeArgs,
  buildReviewPrompt,
  generateJobId,
  loadState,
  parseClaudeJsonResult,
  parseBackgroundLaunch,
  renderHuman,
  resolveStateDir,
  resolveStateRoot,
  resolveWorkspaceIndexDir,
  resolveWorkspaceRoot,
  saveState,
  selectResumeCandidate,
  upsertJob,
  validateReviewPayload
} from "./lib/runtime.mjs";

const DEFAULT_TIMEOUT_MS = 120000;
const SUPPORTED_MAJOR = 2;

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["json", "background", "write", "resume", "fresh"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value == null) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = value;
    index += 1;
  }
  return { options, positionals };
}

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : renderHuman(value));
}

function runClaude(args, options = {}) {
  const result = spawnSync("claude", args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });

  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`Claude command timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`);
  }
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function commandAvailable(commandArgs) {
  const result = runClaude(commandArgs, { timeoutMs: 10000 });
  return result.status === 0;
}

function parseClaudeVersion(stdout) {
  const version = String(stdout || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!version) {
    return { raw: String(stdout || "").trim(), supported: false };
  }
  const major = Number(version[1]);
  return {
    raw: String(stdout || "").trim(),
    major,
    minor: Number(version[2]),
    patch: Number(version[3]),
    supported: major === SUPPORTED_MAJOR || process.env.CLAUDE_PLUGIN_CODEX_ALLOW_UNKNOWN_CLAUDE === "1"
  };
}

function currentContext(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateRoot = resolveStateRoot(process.env);
  const stateDir = resolveStateDir(workspaceRoot, process.env, stateRoot);
  const indexDir = resolveWorkspaceIndexDir(workspaceRoot, process.env, stateRoot);
  return {
    cwd,
    workspaceRoot,
    stateRoot,
    stateDir,
    indexDir,
    state: loadState(stateDir)
  };
}

function persistContext(ctx, state) {
  const saved = saveState(ctx.stateDir, state);
  fs.mkdirSync(ctx.indexDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.indexDir, "latest-state-dir"), `${ctx.stateDir}\n`, "utf8");
  return saved;
}

function gitContext(cwd, options = {}) {
  const target = options.base ? `${options.base}...HEAD` : null;
  const args = target ? ["diff", "--stat", target] : ["status", "--short", "--untracked-files=all"];
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  const first = result.status === 0 ? result.stdout : result.stderr;
  const diffArgs = target ? ["diff", "--", target] : ["diff", "--"];
  const diff = spawnSync("git", diffArgs, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 });
  return [first, diff.status === 0 ? diff.stdout : ""].join("\n").trim();
}

function detectCapabilities() {
  const versionResult = runClaude(["--version"], { timeoutMs: 10000 });
  const version = parseClaudeVersion(versionResult.stdout || versionResult.stderr);
  const auth = runClaude(["auth", "status", "--text"], { timeoutMs: 10000 });
  const print = commandAvailable(["-p", "Return {}", "--output-format", "text", "--max-turns", "1", "--tools", ""]);
  const agents = commandAvailable(["agents", "--help"]);
  const logs = commandAvailable(["logs", "--help"]);
  const stop = commandAvailable(["stop", "--help"]);
  const attach = commandAvailable(["attach", "--help"]);
  const background = version.supported && agents && logs && stop && attach;
  return {
    version,
    auth: {
      loggedIn: auth.status === 0,
      detail: (auth.stdout || auth.stderr).trim()
    },
    print,
    agents,
    logs,
    stop,
    attach,
    background
  };
}

function handleSetup(argv) {
  const { options } = parseArgs(argv);
  const ctx = currentContext(options);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const capabilities = detectCapabilities();
  const ready = nodeMajor >= 18 && capabilities.version.supported && capabilities.auth.loggedIn && capabilities.print;
  const state = persistContext(ctx, { ...ctx.state, capabilities });
  output(
    {
      ready,
      node: { version: process.version, supported: nodeMajor >= 18 },
      capabilities: state.capabilities,
      stateDir: ctx.stateDir
    },
    options.json
  );
}

function createJob(ctx, kind, options = {}) {
  return {
    id: generateJobId(kind),
    kind,
    status: "running",
    write: Boolean(options.write),
    codexThreadId: process.env.CODEX_THREAD_ID || null,
    workspaceRoot: ctx.workspaceRoot,
    summary: options.summary || kind
  };
}

function completeJob(ctx, job, patch) {
  const state = upsertJob(ctx.state, { ...job, ...patch });
  ctx.state = persistContext(ctx, state);
  return ctx.state.jobs.find((item) => item.id === job.id);
}

function runForeground(ctx, kind, prompt, options = {}) {
  const job = createJob(ctx, kind, { write: options.write, summary: prompt.slice(0, 100) });
  ctx.state = persistContext(ctx, upsertJob(ctx.state, job));
  const resume = options.resume ? selectResumeCandidate(ctx.state.jobs.filter((item) => item.id !== job.id), process.env, options) : null;
  const args = buildClaudeArgs({
    mode: kind,
    prompt,
    outputFormat: options.outputFormat || "text",
    maxTurns: Number(options.maxTurns || 3),
    write: Boolean(options.write),
    resumeSessionId: resume?.claudeSessionId ?? null,
    model: options.model || null
  });
  const result = runClaude(args, { cwd: ctx.cwd, timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) });
  const status = result.status === 0 ? "completed" : "failed";
  return completeJob(ctx, job, {
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    claudeSessionId: resume?.claudeSessionId ?? null,
    result: result.stdout.trim()
  });
}

function runBackground(ctx, kind, prompt, options = {}) {
  if (ctx.state.capabilities && !ctx.state.capabilities.background) {
    throw new Error("Claude background mode is unavailable. Run foreground or rerun setup after upgrading Claude Code.");
  }
  const job = createJob(ctx, kind, { write: options.write, summary: prompt.slice(0, 100) });
  const args = buildBackgroundArgs({
    prompt,
    name: `codex-${job.id}`,
    write: Boolean(options.write),
    model: options.model || null
  });
  const result = runClaude(args, { cwd: ctx.cwd, timeoutMs: Number(options.timeoutMs || 30000) });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Claude background launch failed.");
  }
  const claudeSessionId = parseBackgroundLaunch(result.stdout);
  if (!claudeSessionId) {
    throw new Error(`Could not parse Claude background session id from output:\n${result.stdout}`);
  }
  const next = completeJob(ctx, job, {
    status: "running",
    claudeSessionId,
    stdout: result.stdout,
    result: result.stdout.trim()
  });
  return next;
}

function handleTaskCommand(argv, kind) {
  const { options, positionals } = parseArgs(argv);
  const ctx = currentContext(options);
  const prompt = positionals.join(" ").trim();
  const job = options.background
    ? runBackground(ctx, kind, prompt, options)
    : runForeground(ctx, kind, prompt, {
        ...options,
        outputFormat: options["output-format"] || "text",
        maxTurns: options["max-turns"],
        timeoutMs: options["timeout-ms"]
      });
  output(
    {
      jobId: job.id,
      status: job.status,
      claudeSessionId: job.claudeSessionId ?? null,
      output: job.result ?? job.stdout ?? ""
    },
    options.json
  );
}

function handleAdvise(argv) {
  handleTaskCommand(argv, "advise");
}

function handleRescue(argv) {
  handleTaskCommand(argv, "rescue");
}

function handleReview(argv, kind) {
  const { options, positionals } = parseArgs(argv);
  const ctx = currentContext(options);
  const focus = positionals.join(" ").trim();
  const prompt = buildReviewPrompt({
    kind,
    targetLabel: options.base ? `${options.base}...HEAD` : "working tree",
    gitContext: gitContext(ctx.cwd, options),
    focus
  });
  const job = runForeground(ctx, kind, prompt, {
    ...options,
    outputFormat: "json",
    maxTurns: options["max-turns"] || 3,
    timeoutMs: options["timeout-ms"]
  });
  if (job.status !== "completed") {
    output({ jobId: job.id, status: job.status, stderr: job.stderr }, options.json);
    process.exitCode = 1;
    return;
  }
  let parsed;
  let claudeJson;
  try {
    claudeJson = parseClaudeJsonResult(job.stdout);
    parsed = validateReviewPayload(claudeJson.contentRaw);
  } catch (error) {
    const retry = runForeground(ctx, kind, `${prompt}\n\nYour previous response was invalid: ${error.message}. Return JSON only.`, {
      ...options,
      outputFormat: "json",
      maxTurns: 1,
      timeoutMs: options["timeout-ms"]
    });
    claudeJson = parseClaudeJsonResult(retry.stdout);
    parsed = validateReviewPayload(claudeJson.contentRaw);
    Object.assign(job, retry);
  }
  const completed = completeJob(ctx, job, {
    result: parsed,
    claudeSessionId: claudeJson.sessionId ?? job.claudeSessionId ?? null,
    claudeEnvelope: claudeJson.envelope
  });
  output({ jobId: completed.id, status: completed.status, result: parsed }, options.json);
}

function findJob(ctx, reference) {
  if (!reference) {
    return ctx.state.jobs[0] || null;
  }
  return ctx.state.jobs.find((job) => job.id === reference || job.claudeSessionId === reference) || null;
}

function handleStatus(argv) {
  const { options, positionals } = parseArgs(argv);
  const ctx = currentContext(options);
  const job = findJob(ctx, positionals[0]);
  if (!job) {
    output({ jobs: ctx.state.jobs }, options.json);
    return;
  }
  let live = null;
  if (job.claudeSessionId) {
    const result = runClaude(["logs", job.claudeSessionId], { timeoutMs: 10000 });
    live = { available: result.status === 0, output: result.stdout || result.stderr };
  }
  output({ job, live }, options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseArgs(argv);
  const ctx = currentContext(options);
  const job = findJob(ctx, positionals[0]);
  if (!job) {
    throw new Error("No Claude job found.");
  }
  output({ job, result: job.result ?? job.stdout ?? "" }, options.json);
}

function handleCancel(argv) {
  const { options, positionals } = parseArgs(argv);
  const ctx = currentContext(options);
  const job = findJob(ctx, positionals[0]);
  if (!job) {
    throw new Error("No Claude job found.");
  }
  if (job.claudeSessionId) {
    runClaude(["stop", job.claudeSessionId], { timeoutMs: Number(options["timeout-ms"] || 10000) });
  }
  const cancelled = completeJob(ctx, job, { status: "cancelled" });
  output({ jobId: cancelled.id, status: "cancelled" }, options.json);
}

function handleResumeCandidate(argv) {
  const { options } = parseArgs(argv);
  const ctx = currentContext(options);
  let candidate = null;
  try {
    candidate = selectResumeCandidate(ctx.state.jobs, process.env, { resume: true, write: Boolean(options.write) });
  } catch (error) {
    output({ available: false, error: error.message, candidates: ctx.state.jobs }, options.json);
    return;
  }
  output({ available: Boolean(candidate), candidate, candidates: candidate ? [] : ctx.state.jobs }, options.json);
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  claude-companion setup [--json]",
      "  claude-companion advise [--background] [--write] [prompt]",
      "  claude-companion rescue [--background] [--write] [--resume] [prompt]",
      "  claude-companion review [--base <ref>] [--json]",
      "  claude-companion adversarial-review [--base <ref>] [focus] [--json]",
      "  claude-companion status [job-id] [--json]",
      "  claude-companion result [job-id] [--json]",
      "  claude-companion cancel [job-id] [--json]",
      "  claude-companion resume-candidate [--json]"
    ].join("\n") + "\n"
  );
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }
  switch (command) {
    case "setup":
      handleSetup(argv);
      break;
    case "advise":
      handleAdvise(argv);
      break;
    case "rescue":
      handleRescue(argv);
      break;
    case "review":
      handleReview(argv, "review");
      break;
    case "adversarial-review":
      handleReview(argv, "adversarial-review");
      break;
    case "status":
      handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      handleCancel(argv);
      break;
    case "resume-candidate":
      handleResumeCandidate(argv);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
