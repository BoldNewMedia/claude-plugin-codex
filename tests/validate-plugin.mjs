import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("plugins/claude-code-advisor/.codex-plugin/plugin.json", "utf8"));
const marketplace = JSON.parse(fs.readFileSync(".agents/plugins/marketplace.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const skill = fs.readFileSync("plugins/claude-code-advisor/skills/claude/SKILL.md", "utf8");

assert.equal(manifest.name, "claude-code-advisor");
assert.equal(manifest.skills, "./skills/");
assert.ok(manifest.interface?.displayName);
assert.deepEqual(manifest.interface?.capabilities, ["Read", "Write"]);
assert.equal(manifest.interface?.privacyPolicyURL, "https://github.com/yanchuk/claude-plugin-codex#privacy");
assert.equal(manifest.interface?.termsOfServiceURL, "https://github.com/yanchuk/claude-plugin-codex#terms");
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/icon.svg"));
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/logo.svg"));
assert.ok(marketplace.plugins.some((plugin) => plugin.name === "claude-code-advisor"));
assert.equal(packageJson.scripts["test:e2e:codex"], "node tests/e2e-codex-skill.mjs");
assert.ok(fs.existsSync("tests/e2e-codex-skill.mjs"));
assert.match(skill, /^---\nname: claude\n/m);
assert.match(skill, /claude-companion\.mjs/);

console.log("plugin metadata ok");
