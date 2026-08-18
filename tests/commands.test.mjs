import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const companion = fileURLToPath(
  new URL("../plugins/claude-code-advisor/scripts/claude-companion.mjs", import.meta.url)
);

const TEST_RESUME_UUID = "123e4567-e89b-42d3-a456-426614174000";

function initRepo(prefix = "claude-command-repo-") {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  return repo;
}

function makeFakeClaude(scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${scriptBody}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

function makeFakeClaudeExpectingMaxTurns(expected) {
  return makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  const index = args.indexOf("--max-turns");
  if (args[index + 1] !== ${JSON.stringify(String(expected))}) {
    console.error("expected --max-turns ${expected}, got " + args[index + 1]);
    process.exit(2);
  }
  console.log("ok");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
}

test("setup reports supervised background capability without legacy lifecycle commands", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log("logged in"); process.exit(0); }
if (args[0] === "logs") process.exit(2);
if (args[0] === "stop") process.exit(2);
if (args[0] === "attach") process.exit(2);
if (args[0] === "agents") process.exit(2);
if (args.includes("-p")) { console.log("{}"); process.exit(0); }
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  fs.chmodSync(stateRoot, 0o755);
  const stdout = execFileSync(process.execPath, [companion, "setup", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.ready, true);
  assert.equal(payload.capabilities.print, true);
  assert.equal(payload.capabilities.background, true);
  assert.equal(fs.statSync(stateRoot).mode & 0o777, 0o755);
  const workspaceIndex = fs.readdirSync(stateRoot).find((entry) => entry.startsWith("claude-state-"));
  assert.ok(workspaceIndex);
  const indexDir = path.join(stateRoot, workspaceIndex);
  const latestStateFile = path.join(indexDir, "latest-state-dir");
  const stateDir = fs.readFileSync(latestStateFile, "utf8").trim();
  assert.equal(fs.statSync(indexDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(stateDir, "state.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(latestStateFile).mode & 0o777, 0o600);
});

test("review returns validated JSON and stores result", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args.includes("-p")) {
  console.log(JSON.stringify({findings:[{severity:"MAJOR",title:"Gap",fact:"No test",recommendation:"Add test"}]}));
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const repo = initRepo("claude-review-result-");
  const env = {
    ...process.env,
    PATH: `${fake.dir}:${process.env.PATH}`,
    CLAUDE_COMPANION_STATE_ROOT: stateRoot,
    CODEX_THREAD_ID: "thread-a"
  };
  const stdout = execFileSync(process.execPath, [companion, "review", "--json"], {
    env,
    cwd: repo,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.result.findings[0].severity, "MAJOR");

  const result = execFileSync(process.execPath, [companion, "result", payload.jobId, "--json"], {
    env,
    cwd: repo,
    encoding: "utf8"
  });
  assert.equal(JSON.parse(result).job.id, payload.jobId);
});

test("review base range includes the patch in the Claude prompt", () => {
  const promptLog = path.join(os.tmpdir(), `fake-review-base-${Date.now()}.log`);
  const fake = makeFakeClaude(`
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("-p")) {
  fs.writeFileSync(${JSON.stringify(promptLog)}, args[args.indexOf("-p") + 1]);
  console.log(JSON.stringify({findings:[]}));
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-base-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "sample.txt"), "before\n", "utf8");
  execFileSync("git", ["add", "sample.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(repo, "sample.txt"), "after-base-range\n", "utf8");
  execFileSync("git", ["add", "sample.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "change"], { cwd: repo });
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));

  execFileSync(process.execPath, [companion, "review", "--base", base, "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: repo,
    encoding: "utf8"
  });

  assert.match(fs.readFileSync(promptLog, "utf8"), /after-base-range/);
});

test("working-tree review includes staged patch content", () => {
  const promptLog = path.join(os.tmpdir(), `fake-review-staged-${Date.now()}.log`);
  const fake = makeFakeClaude(`
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("-p")) {
  fs.writeFileSync(${JSON.stringify(promptLog)}, args[args.indexOf("-p") + 1]);
  console.log(JSON.stringify({findings:[]}));
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-staged-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "sample.txt"), "before\n", "utf8");
  execFileSync("git", ["add", "sample.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "sample.txt"), "after-staging\n", "utf8");
  execFileSync("git", ["add", "sample.txt"], { cwd: repo });
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));

  execFileSync(process.execPath, [companion, "review", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: repo,
    encoding: "utf8"
  });

  assert.match(fs.readFileSync(promptLog, "utf8"), /after-staging/);
});

test("working-tree review refuses untracked files whose contents would be omitted", () => {
  const fake = makeFakeClaude(`
console.error("Claude should not run when untracked files are present");
process.exit(2);
`);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-untracked-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "new-source.mjs"), "export const value = 1;\n", "utf8");
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));

  const reviewed = spawnSync(process.execPath, [companion, "review", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: repo,
    encoding: "utf8"
  });

  assert.notEqual(reviewed.status, 0);
  assert.match(reviewed.stderr, /Stage the intended files first/);
  assert.match(reviewed.stderr, /new-source\.mjs/);
});

test("review defaults to a single Claude turn", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  const index = args.indexOf("--max-turns");
  if (args[index + 1] !== "1") {
    console.error("expected --max-turns 1, got " + args[index + 1]);
    process.exit(2);
  }
  console.log(JSON.stringify({findings:[]}));
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const repo = initRepo("claude-review-turns-");
  const stdout = execFileSync(process.execPath, [companion, "review", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: repo,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
});

test("foreground advise defaults to a larger turn budget", () => {
  const fake = makeFakeClaudeExpectingMaxTurns(20);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "advise", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("foreground do defaults to a larger turn budget", () => {
  const fake = makeFakeClaudeExpectingMaxTurns(20);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "do", "inspect local code", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("foreground rescue defaults to a larger turn budget", () => {
  const fake = makeFakeClaudeExpectingMaxTurns(20);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "rescue", "diagnose the failure", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("foreground task max-turn override takes precedence over the default", () => {
  const fake = makeFakeClaudeExpectingMaxTurns(5);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(
    process.execPath,
    [companion, "do", "--max-turns", "5", "inspect local code", "--json"],
    {
      env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
      cwd: stateRoot,
      encoding: "utf8"
    }
  );
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("foreground task max-turn failure includes rerun hint", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  console.error("Claude hit max turns before producing a result.");
  process.exit(1);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "do", "inspect local code", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "failed");
  assert.match(payload.output, /Claude hit the max-turn limit/);
  assert.match(payload.output, /--max-turns <higher>/);
});

test("foreground advise defaults to xhigh effort", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  const index = args.indexOf("--effort");
  if (args[index + 1] !== "xhigh") {
    console.error("expected --effort xhigh, got " + args[index + 1]);
    process.exit(2);
  }
  console.log("ok");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "advise", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("background advise refuses project MCP config unless explicitly allowed", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args[0] === "--bg") {
  console.error("background should not launch");
  process.exit(2);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  fs.writeFileSync(path.join(stateRoot, ".mcp.json"), '{"mcpServers":{"playwright":{}}}\n', "utf8");
  const result = spawnSync(process.execPath, [companion, "advise", "--background", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.mcp\.json/);
  assert.match(result.stderr, /--allow-mcp/);
});

test("background advise refuses MCP config above a nested worktree", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args[0] === "--bg") {
  console.error("background should not launch");
  process.exit(2);
}
console.error("unsupported"); process.exit(2);
`);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "claude-parent-mcp-"));
  const child = path.join(parent, ".worktrees", "task");
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(parent, ".mcp.json"), '{"mcpServers":{"playwright":{}}}\n', "utf8");
  fs.writeFileSync(path.join(child, ".git"), "gitdir: ../.git/worktrees/task\n", "utf8");
  const result = spawnSync(process.execPath, [companion, "advise", "--background", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: parent },
    cwd: child,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.mcp\\.json`));
  assert.match(result.stderr, /--allow-mcp/);
});

test("read-only do defaults to local read-only tools without WebFetch", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  const tools = args[args.indexOf("--tools") + 1];
  if (tools !== "Read,Glob,Grep") {
    console.error("expected local read-only tools, got " + tools);
    process.exit(2);
  }
  console.log("done");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "do", "inspect local code", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "done");
});

test("foreground advise falls back to background on timeout", () => {
  const nameLog = path.join(os.tmpdir(), `fake-name-${Date.now()}.log`);
  const fake = makeFakeClaude(`
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--bg")) {
  fs.writeFileSync(${JSON.stringify(nameLog)},args[args.indexOf("--name")+1]);
  console.log("backgrounded · bg123 (idle - send a prompt to start)");
  process.exit(0);
}
if (args[0] === "agents") { console.log(JSON.stringify([{id:"bg123",sessionId:${JSON.stringify(TEST_RESUME_UUID)},name:fs.readFileSync(${JSON.stringify(nameLog)},"utf8"),status:"active",state:"working"}])); process.exit(0); }
if (args.includes("-p")) {
  setTimeout(() => process.exit(0), 5000);
} else {
  console.error("unsupported"); process.exit(2);
}
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const stdout = execFileSync(
    process.execPath,
    [companion, "advise", "--timeout-ms", "50", "check architecture", "--json"],
    { env, cwd: stateRoot, encoding: "utf8" }
  );
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "running");
  assert.equal(payload.claudeSessionId, null);
  assert.match(payload.output, /Foreground Claude timed out/);

  const status = execFileSync(process.execPath, [companion, "status", payload.jobId, "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  assert.equal(JSON.parse(status).job.fallbackReason, "foreground-timeout");
});

test("foreground advise can disable timeout background fallback", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  setTimeout(() => process.exit(0), 5000);
} else {
  console.error("unsupported"); process.exit(2);
}
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const result = spawnSync(
    process.execPath,
    [companion, "advise", "--timeout-ms", "50", "--no-background-fallback", "slow"],
    {
      env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
      cwd: stateRoot,
      encoding: "utf8"
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/);
});

test("foreground advise prints human output by default", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) { console.log("human answer"); process.exit(0); }
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion, "advise", "check architecture"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });

  assert.equal(stdout, "human answer\n");
});

test("rescue runs as a managed task and preserves explicit write mode", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args.includes("-p")) {
  if (!args.includes("--permission-mode") || !args.includes("default")) {
    console.error("expected write-capable default permission mode");
    process.exit(2);
  }
  console.log("rescued");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const stdout = execFileSync(process.execPath, [companion, "rescue", "--write", "fix the failing test", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.match(payload.jobId, /^rescue-/);
  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "rescued");

  const result = execFileSync(process.execPath, [companion, "result", payload.jobId, "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  assert.equal(JSON.parse(result).job.write, true);
});

test("rescue is read-only unless --write is explicit", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args.includes("-p")) {
  if (!args.includes("--permission-mode") || !args.includes("plan")) {
    console.error("expected plan permission mode");
    process.exit(2);
  }
  console.log("diagnosis only");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const stdout = execFileSync(process.execPath, [companion, "rescue", "diagnose the failure", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.match(payload.jobId, /^rescue-/);
  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "diagnosis only");
});

test("do runs a prepared Claude task and preserves explicit write mode", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  if (!args.includes("--permission-mode") || !args.includes("default")) {
    console.error("expected write-capable default permission mode");
    process.exit(2);
  }
  if (!args.includes("--model") || args[args.indexOf("--model") + 1] !== "sonnet") {
    console.error("expected explicit sonnet model");
    process.exit(2);
  }
  console.log("done");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const stdout = execFileSync(
    process.execPath,
    [companion, "do", "--write", "--model", "sonnet", "implement the prepared task", "--json"],
    { env, cwd: stateRoot, encoding: "utf8" }
  );
  const payload = JSON.parse(stdout);

  assert.match(payload.jobId, /^do-/);
  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "done");
});

test("working-tree and base reviews fail closed when the diff exceeds one MiB", () => {
  for (const mode of ["working-tree", "base"]) {
    const called = path.join(os.tmpdir(), `fake-called-${mode}-${Date.now()}.txt`);
    const fake = makeFakeClaude(`const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(called)},"called");process.exit(2);`);
    const repo = initRepo(`claude-large-${mode}-`);
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(repo, "tracked.txt"), `tracked\n${"x".repeat(1024 * 1024 + 8192)}\n`, "utf8");
    if (mode === "base") {
      execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
      execFileSync("git", ["commit", "-qm", "large"], { cwd: repo });
    }
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
    const args = [companion, "review", ...(mode === "base" ? ["--base", base] : []), "--json"];
    const reviewed = spawnSync(process.execPath, args, { env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot }, cwd: repo, encoding: "utf8" });
    assert.notEqual(reviewed.status, 0);
    assert.match(reviewed.stderr, /1048576-byte review limit/);
    assert.equal(fs.existsSync(called), false);
  }
});

test("a distinctive marker near the diff limit reaches Claude completely", () => {
  const promptLog = path.join(os.tmpdir(), `fake-large-prompt-${Date.now()}.txt`);
  const fake = makeFakeClaude(`
const fs=require("node:fs");const args=process.argv.slice(2);
if(args.includes("-p")){fs.writeFileSync(${JSON.stringify(promptLog)},args[args.indexOf("-p")+1]);console.log(JSON.stringify({findings:[]}));process.exit(0)}
process.exit(2);
`);
  const repo = initRepo("claude-near-limit-");
  const marker = "DISTINCTIVE_FINAL_DIFF_MARKER_7f58e";
  fs.writeFileSync(path.join(repo, "tracked.txt"), `tracked\n${"y".repeat(880 * 1024)}\n${marker}\n`, "utf8");
  const diffBytes = Buffer.byteLength(execFileSync("git", ["diff", "HEAD", "--"], { cwd: repo }));
  assert.ok(diffBytes >= 880 * 1024, `expected a near-limit diff, received ${diffBytes} bytes`);
  assert.ok(diffBytes < 1024 * 1024, `expected a below-limit diff, received ${diffBytes} bytes`);
  assert.ok(1024 * 1024 - diffBytes < 160 * 1024, `diff was not close enough to the limit: ${diffBytes} bytes`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  execFileSync(process.execPath, [companion, "review", "--json"], { env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot }, cwd: repo, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.match(fs.readFileSync(promptLog, "utf8"), new RegExp(marker));
});

test("monitor refuses unbounded, invalid and oversized bounds before polling", () => {
  const nameLog = path.join(os.tmpdir(), `fake-bounds-name-${Date.now()}.log`);
  const pollCount = path.join(os.tmpdir(), `fake-bounds-polls-${Date.now()}.txt`);
  fs.writeFileSync(pollCount, "0", "utf8");
  const fake = makeFakeClaude(`
const fs=require("node:fs");const args=process.argv.slice(2);
if(args.includes("--bg")){fs.writeFileSync(${JSON.stringify(nameLog)},args[args.indexOf("--name")+1]);console.log("backgrounded · bounds8");process.exit(0)}
if(args[0]==="agents"){const n=Number(fs.readFileSync(${JSON.stringify(pollCount)},"utf8"))+1;fs.writeFileSync(${JSON.stringify(pollCount)},String(n));console.log(JSON.stringify([{id:"bounds8",sessionId:${JSON.stringify(TEST_RESUME_UUID)},name:fs.readFileSync(${JSON.stringify(nameLog)},"utf8"),status:"active",state:"working"}]));process.exit(0)}
if(args[0]==="logs"){console.log("progress");process.exit(0)}
process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-monitor-bounds-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const launched = JSON.parse(execFileSync(process.execPath, [companion, "advise", "--background", "answer", "--json"], { env, cwd: stateRoot, encoding: "utf8" }));
  const afterLaunch = fs.readFileSync(pollCount, "utf8");
  const cases = [
    [["--forever"], /Unbounded --forever/],
    [["--max-checks", "0"], /integer between 1 and 1000/],
    [["--max-checks", "1001"], /integer between 1 and 1000/],
    [["--max-checks", "1.5"], /integer between 1 and 1000/],
    [["--max-checks", "invalid"], /integer between 1 and 1000/],
    [["--interval-ms", "-1"], /between 0 and 3600000/],
    [["--interval-ms", "3600001"], /between 0 and 3600000/],
    [["--interval-ms", "invalid"], /between 0 and 3600000/]
  ];
  for (const [bounds, message] of cases) {
    const refused = spawnSync(process.execPath, [companion, "monitor", launched.jobId, ...bounds, "--json"], { env, cwd: stateRoot, encoding: "utf8" });
    assert.notEqual(refused.status, 0, bounds.join(" "));
    assert.match(refused.stderr, message, bounds.join(" "));
  }
  assert.equal(fs.readFileSync(pollCount, "utf8"), afterLaunch);
});

test("Git execution and invalid-base errors fail before Claude review", () => {
  const called = path.join(os.tmpdir(), `fake-git-called-${Date.now()}.txt`);
  const fake = makeFakeClaude(`const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(called)},"called");process.exit(2);`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-not-repo-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const executionError = spawnSync(process.execPath, [companion, "review", "--json"], { env, cwd: notRepo, encoding: "utf8" });
  assert.notEqual(executionError.status, 0);
  assert.match(executionError.stderr, /Git exited with status/);
  const repo = initRepo("claude-invalid-base-");
  const invalidBase = spawnSync(process.execPath, [companion, "review", "--base", "missing-ref", "--json"], { env, cwd: repo, encoding: "utf8" });
  assert.notEqual(invalidBase.status, 0);
  assert.match(invalidBase.stderr, /Git exited with status/);
  assert.equal(fs.existsSync(called), false);
});

test("foreground timeout fails the job without hanging", () => {
  const fake = makeFakeClaude(`
setTimeout(() => {}, 5000);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const result = spawnSync(process.execPath, [companion, "advise", "--timeout-ms", "50", "--no-background-fallback", "slow"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/);
});
