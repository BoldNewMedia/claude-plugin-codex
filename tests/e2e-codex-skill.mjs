import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname;
const skillMarker = "claude-code-advisor:claude";
const setupPrompt = [
  "Use $claude setup to check Claude Code readiness.",
  "Do not modify files.",
  "Return only a concise PASS/FAIL summary with the key command result."
].join(" ");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function parseJsonLines(output) {
  return output
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

const promptInput = run("codex", ["debug", "prompt-input", "Check Claude plugin availability."]);
assert.match(
  promptInput,
  new RegExp(skillMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "Codex prompt input does not include the installed claude-code-advisor skill. Run `codex plugin marketplace add ./`, install Claude Code Advisor in Codex, and start a fresh Codex session."
);

const statusBefore = run("git", ["status", "--short"]);
const execOutput = run("codex", ["exec", "--cd", repoRoot, "--json", setupPrompt], { input: "" });
const events = parseJsonLines(execOutput);
const setupCommand = events.find((event) => {
  return event.type === "item.completed"
    && event.item?.type === "command_execution"
    && event.item.command?.includes("claude-companion.mjs")
    && event.item.command?.includes("setup --json");
});

assert.ok(setupCommand, "Codex did not route $claude setup through claude-companion.mjs.");
assert.equal(
  setupCommand.item.exit_code,
  0,
  `claude-companion setup failed.\nCommand: ${setupCommand.item.command}\nOutput:\n${setupCommand.item.aggregated_output}`
);

const setupPayload = JSON.parse(setupCommand.item.aggregated_output);
assert.equal(setupPayload.ready, true);
assert.equal(setupPayload.capabilities.auth.loggedIn, true);
assert.equal(setupPayload.capabilities.version.supported, true);

const statusAfter = run("git", ["status", "--short"]);
assert.equal(statusAfter, statusBefore, "Codex E2E smoke changed the repository working tree.");

console.log(`codex skill routing ok: Claude Code ${setupPayload.capabilities.version.raw}`);
