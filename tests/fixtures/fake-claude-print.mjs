#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const fixturePath = fileURLToPath(import.meta.url);

if (args[0] === "--fixture-grandchild") {
  const [, pidFile, ignoreTerm = "0"] = args;
  if (ignoreTerm === "1") process.on("SIGTERM", () => {});
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
  setInterval(() => {}, 1000);
  process.stdin.resume();
} else {
  const scenario = JSON.parse(fs.readFileSync(process.env.CLAUDE_TEST_SCENARIO, "utf8"));
  const stdin = await new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.resume();
  });
  fs.appendFileSync(
    scenario.invocationLog,
    `${JSON.stringify({ args, stdinBase64: stdin.toString("base64") })}\n`,
    "utf8"
  );

  if (args.includes("--version")) {
    process.stdout.write("2.1.234 (Claude Code)\n");
    process.exit(0);
  }
  if (args[0] === "auth" && args[1] === "status") {
    process.stdout.write("logged in\n");
    process.exit(0);
  }
  if (args[0] === "agents") {
    const name = fs.existsSync(scenario.nameFile) ? fs.readFileSync(scenario.nameFile, "utf8") : "legacy-test";
    process.stdout.write(JSON.stringify([{
      id: "bg-test",
      sessionId: scenario.sessionId,
      name,
      status: scenario.legacyLifecycle || "completed",
      state: scenario.legacyLifecycle === "active" ? "working" : "done"
    }]));
    process.exit(0);
  }
  if (args[0] === "logs") {
    process.stdout.write(Buffer.from(scenario.stdoutBase64 || "", "base64"));
    process.exit(0);
  }
  if (args[0] === "stop") {
    process.exit(0);
  }
  if (args.includes("--bg")) {
    const nameIndex = args.indexOf("--name");
    fs.writeFileSync(scenario.nameFile, nameIndex >= 0 ? args[nameIndex + 1] : "legacy-test", "utf8");
    if (scenario.spawnGrandchild) {
      const grandchild = spawn(
        process.execPath,
        [fixturePath, "--fixture-grandchild", scenario.grandchildPidFile, "1"],
        { detached: true, stdio: "ignore" }
      );
      grandchild.unref();
    }
    process.stdout.write("backgrounded · bg-test (idle - send a prompt to start)\n");
    process.exit(0);
  }
  if (!args.includes("-p")) process.exit(2);

  if (scenario.ignoreTerm) process.on("SIGTERM", () => {});
  if (scenario.spawnGrandchild) {
    spawn(
      process.execPath,
      [fixturePath, "--fixture-grandchild", scenario.grandchildPidFile, scenario.grandchildIgnoresTerm ? "1" : "0"],
      { detached: false, stdio: "ignore" }
    );
  }
  if (scenario.startedFile) fs.writeFileSync(scenario.startedFile, "started\n", "utf8");
  if (scenario.gateFile) {
    const deadline = Date.now() + Number(scenario.gateTimeoutMs || 10000);
    while (!fs.existsSync(scenario.gateFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const writeChunks = async (stream, chunks = []) => {
    for (const entry of chunks) {
      if (entry.delayMs) await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
      stream.write(Buffer.from(entry.base64, "base64"));
    }
  };
  const stdoutChunks = scenario.stdoutChunks || [{ base64: scenario.stdoutBase64 || "" }];
  const stderrChunks = scenario.stderrChunks || [{ base64: scenario.stderrBase64 || "" }];
  await Promise.all([writeChunks(process.stdout, stdoutChunks), writeChunks(process.stderr, stderrChunks)]);
  process.exit(Number(scenario.exitStatus || 0));
}
