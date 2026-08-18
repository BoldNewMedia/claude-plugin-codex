import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");
const skillMarker = "claude-code-advisor:claude";
const advisePrompt = [
  "Use $claude advise --model sonnet --max-turns 1 --timeout-ms 120000 to ask Claude Code to reply with exactly PASS.",
  "Do not modify files.",
  "Return only a concise PASS/FAIL summary with the key command result."
].join(" ");
const safeStages = new Set([
  "preflight",
  "prompt-input",
  "worktree-before",
  "state-setup",
  "codex-exec",
  "state-cleanup",
  "routed-command",
  "routed-output",
  "worktree-after",
  "internal"
]);
const safeReasons = new Set([
  "invalid-repository",
  "missing-skill",
  "timeout",
  "spawn-error",
  "signal",
  "non-zero-exit",
  "filesystem",
  "routing-missing",
  "companion-failed",
  "unexpected-result",
  "worktree-changed",
  "unexpected"
]);

function e2eFailure(stage, reason) {
  const error = new Error("Codex routing E2E failed.");
  error.e2eStage = safeStages.has(stage) ? stage : "internal";
  error.e2eReason = safeReasons.has(reason) ? reason : "unexpected";
  return error;
}

export function renderE2eFailure(candidate) {
  const stage = safeStages.has(candidate?.e2eStage) ? candidate.e2eStage : "internal";
  const reason = safeReasons.has(candidate?.e2eReason) ? candidate.e2eReason : "unexpected";
  return `Codex E2E FAIL (${stage}:${reason}).`;
}

export function classifyCommandFailure(result) {
  if (result?.error?.code === "ETIMEDOUT") return "timeout";
  if (result?.error) return "spawn-error";
  if (result?.signal) return "signal";
  if (!Number.isInteger(result?.status) || result.status !== 0) return "non-zero-exit";
  return null;
}

export function classifyRoutedOutput(value) {
  const output = typeof value === "string" ? value : "";
  if (output === "PASS\n") return "authenticated";
  if (/^Claude job advise-[a-z0-9]+-[a-z0-9]{1,6} failed\.\nNot logged in · Please run \/login\n$/u.test(output)) {
    return "authentication-unavailable";
  }
  return "unexpected";
}

function run(stage, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    ...options
  });
  const failure = classifyCommandFailure(result);
  if (failure) throw e2eFailure(stage, failure);
  return result.stdout;
}

function parseJsonLines(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function main() {
  if (!fs.existsSync(path.join(repoRoot, "package.json"))) {
    throw e2eFailure("preflight", "invalid-repository");
  }

  const promptInput = run("prompt-input", "codex", ["debug", "prompt-input", "Check Claude plugin availability."]);
  if (!promptInput.includes(skillMarker)) throw e2eFailure("prompt-input", "missing-skill");

  const statusBefore = run("worktree-before", "git", ["status", "--short"]);
  let stateRoot;
  try {
    stateRoot = fs.mkdtempSync(path.join(repoRoot, ".claude-plugin-codex-e2e-state-"));
  } catch {
    throw e2eFailure("state-setup", "filesystem");
  }

  let execOutput;
  try {
    execOutput = run(
      "codex-exec",
      "codex",
      ["exec", "--sandbox", "workspace-write", "--cd", repoRoot, "--json", advisePrompt],
      { input: "", env: { ...process.env, CLAUDE_COMPANION_STATE_ROOT: stateRoot } }
    );
  } finally {
    try {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    } catch {
      throw e2eFailure("state-cleanup", "filesystem");
    }
  }

  const adviseCommands = parseJsonLines(execOutput).filter((event) => {
    return event.type === "item.completed"
      && event.item?.type === "command_execution"
      && event.item.command?.includes("claude-companion.mjs")
      && event.item.command?.includes("advise")
      && event.item.command?.includes("--model sonnet");
  });
  if (adviseCommands.length !== 1) throw e2eFailure("routed-command", "routing-missing");
  const adviseCommand = adviseCommands[0];
  if (adviseCommand.item.exit_code !== 0) throw e2eFailure("routed-command", "companion-failed");

  const routedClassification = classifyRoutedOutput(adviseCommand.item.aggregated_output);
  if (routedClassification === "unexpected") throw e2eFailure("routed-output", "unexpected-result");

  const statusAfter = run("worktree-after", "git", ["status", "--short"]);
  if (statusAfter !== statusBefore) throw e2eFailure("worktree-after", "worktree-changed");

  console.log(
    routedClassification === "authenticated"
      ? "codex skill routing ok: authenticated Claude advise used --model sonnet"
      : "codex skill routing ok: Claude advise used --model sonnet; nested sandbox authentication was unavailable"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${renderE2eFailure(error)}\n`);
    process.exitCode = 1;
  }
}
