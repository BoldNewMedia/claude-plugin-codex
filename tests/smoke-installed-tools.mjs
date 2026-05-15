import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

console.log(run("claude", ["--version"]));

if (process.env.CLAUDE_PLUGIN_CODEX_RUN_BG_SMOKE === "1") {
  const output = run("claude", ["--bg", "--name", "claude-plugin-codex-smoke", "noop"]);
  const match = output.match(/backgrounded\s+.\s+([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(`Could not parse background id from:\n${output}`);
  }
  run("claude", ["stop", match[1]]);
  console.log(`background smoke ok: ${match[1]}`);
} else {
  console.log("Skipping background smoke; set CLAUDE_PLUGIN_CODEX_RUN_BG_SMOKE=1 to run it.");
}
