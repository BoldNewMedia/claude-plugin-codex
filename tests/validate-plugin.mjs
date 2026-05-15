import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("plugins/claude-code-advisor/.codex-plugin/plugin.json", "utf8"));
const marketplace = JSON.parse(fs.readFileSync(".agents/plugins/marketplace.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const skill = fs.readFileSync("plugins/claude-code-advisor/skills/claude/SKILL.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const e2e = fs.readFileSync("tests/e2e-codex-skill.mjs", "utf8");

assert.equal(manifest.name, "claude-code-advisor");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.interface?.displayName, "Claude");
assert.deepEqual(manifest.interface?.capabilities, ["Read", "Write"]);
assert.equal(manifest.interface?.privacyPolicyURL, "https://github.com/yanchuk/claude-plugin-codex#privacy");
assert.equal(manifest.interface?.termsOfServiceURL, "https://github.com/yanchuk/claude-plugin-codex#terms");
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/icon.svg"));
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/logo.svg"));
assert.equal(fs.readlinkSync("CLAUDE.md"), "AGENTS.md");
assert.ok(marketplace.plugins.some((plugin) => plugin.name === "claude-code-advisor"));
assert.equal(packageJson.scripts["test:e2e:codex"], "node tests/e2e-codex-skill.mjs");
assert.ok(fs.existsSync("tests/e2e-codex-skill.mjs"));
assert.match(skill, /^---\nname: claude\n/m);
assert.match(skill, /claude-companion\.mjs/);
assert.match(skill, /\/claude:rescue/);
assert.match(skill, /\$claude monitor/);
assert.match(skill, /Do not pass `--model sonnet`/);
assert.match(skill, /`--effort xhigh`/);
assert.match(skill, /--stale-after-ms 120000/);
assert.match(readme, /Unable to load skill contents/);
assert.match(readme, /\$claude advise --model sonnet/);
assert.match(e2e, /--model sonnet/);

console.log("plugin metadata ok");
