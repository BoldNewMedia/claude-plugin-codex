import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const companion = new URL("../plugins/claude-code-advisor/scripts/claude-companion.mjs", import.meta.url);

function makeFakeClaude(scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${scriptBody}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

test("setup writes a capabilities manifest and degrades background when lifecycle is unavailable", () => {
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
  const stdout = execFileSync(process.execPath, [companion.pathname, "setup", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.ready, true);
  assert.equal(payload.capabilities.print, true);
  assert.equal(payload.capabilities.background, false);
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
  const env = {
    ...process.env,
    PATH: `${fake.dir}:${process.env.PATH}`,
    CLAUDE_COMPANION_STATE_ROOT: stateRoot,
    CODEX_THREAD_ID: "thread-a"
  };
  const stdout = execFileSync(process.execPath, [companion.pathname, "review", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.result.findings[0].severity, "MAJOR");

  const result = execFileSync(process.execPath, [companion.pathname, "result", payload.jobId, "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  assert.equal(JSON.parse(result).job.id, payload.jobId);
});

test("background advise stores Claude session id and cancel calls claude stop", () => {
  const stopLog = path.join(os.tmpdir(), `fake-stop-${Date.now()}.log`);
  const fake = makeFakeClaude(`
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args[0] === "--bg") { console.log("backgrounded · bg123 (idle - send a prompt to start)"); process.exit(0); }
if (args[0] === "logs") { console.log("latest output"); process.exit(0); }
if (args[0] === "stop") { fs.writeFileSync(${JSON.stringify(stopLog)}, args[1]); console.log("stopped " + args[1]); process.exit(0); }
if (args[0] === "agents") { console.log("11 active agents"); process.exit(0); }
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const stdout = execFileSync(process.execPath, [companion.pathname, "advise", "--background", "check architecture", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "running");
  assert.equal(payload.claudeSessionId, "bg123");

  const cancel = execFileSync(process.execPath, [companion.pathname, "cancel", payload.jobId, "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  assert.equal(JSON.parse(cancel).status, "cancelled");
  assert.equal(fs.readFileSync(stopLog, "utf8"), "bg123");
});

test("monitor polls Claude logs and active agent state", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.132 (Claude Code)"); process.exit(0); }
if (args[0] === "--bg") { console.log("backgrounded · bg123 (idle - send a prompt to start)"); process.exit(0); }
if (args[0] === "logs") { console.log("\\u001b7\\u001b[31mprogress: still working\\u001b[39m\\u001b8"); process.exit(0); }
if (args[0] === "agents") { console.log("bg123 running"); process.exit(0); }
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const env = { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot };
  const launched = execFileSync(process.execPath, [companion.pathname, "advise", "--background", "check architecture", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const job = JSON.parse(launched);
  const watched = execFileSync(
    process.execPath,
    [companion.pathname, "monitor", job.jobId, "--interval-ms", "1", "--max-checks", "2", "--json"],
    { env, cwd: stateRoot, encoding: "utf8" }
  );
  const snapshots = watched.trim().split(/\r?\n/).map((line) => JSON.parse(line));

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].active, true);
  assert.equal(snapshots[0].logs.output, "progress: still working");
});

test("foreground advise defaults to a larger turn budget", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) {
  const index = args.indexOf("--max-turns");
  if (args[index + 1] !== "8") {
    console.error("expected --max-turns 8, got " + args[index + 1]);
    process.exit(2);
  }
  console.log("ok");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion.pathname, "advise", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
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
  const stdout = execFileSync(process.execPath, [companion.pathname, "advise", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "ok");
});

test("background advise defaults to xhigh effort", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args[0] === "--bg") {
  const index = args.indexOf("--effort");
  if (args[index + 1] !== "xhigh") {
    console.error("expected --effort xhigh, got " + args[index + 1]);
    process.exit(2);
  }
  console.log("backgrounded · bg123 (idle - send a prompt to start)");
  process.exit(0);
}
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion.pathname, "advise", "--background", "check architecture", "--json"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "running");
  assert.equal(payload.claudeSessionId, "bg123");
});

test("foreground advise prints human output by default", () => {
  const fake = makeFakeClaude(`
const args = process.argv.slice(2);
if (args.includes("-p")) { console.log("human answer"); process.exit(0); }
console.error("unsupported"); process.exit(2);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const stdout = execFileSync(process.execPath, [companion.pathname, "advise", "check architecture"], {
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
  const stdout = execFileSync(process.execPath, [companion.pathname, "rescue", "--write", "fix the failing test", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.match(payload.jobId, /^rescue-/);
  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "rescued");

  const result = execFileSync(process.execPath, [companion.pathname, "result", payload.jobId, "--json"], {
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
  const stdout = execFileSync(process.execPath, [companion.pathname, "rescue", "diagnose the failure", "--json"], {
    env,
    cwd: stateRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(stdout);

  assert.match(payload.jobId, /^rescue-/);
  assert.equal(payload.status, "completed");
  assert.equal(payload.output, "diagnosis only");
});

test("foreground timeout fails the job without hanging", () => {
  const fake = makeFakeClaude(`
setTimeout(() => {}, 5000);
`);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-state-"));
  const result = spawnSync(process.execPath, [companion.pathname, "advise", "--timeout-ms", "50", "slow"], {
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}`, CLAUDE_COMPANION_STATE_ROOT: stateRoot },
    cwd: stateRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/);
});
