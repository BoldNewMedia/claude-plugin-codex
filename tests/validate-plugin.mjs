import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("plugins/claude-code-advisor/.codex-plugin/plugin.json", "utf8"));
const marketplace = JSON.parse(fs.readFileSync(".agents/plugins/marketplace.json", "utf8"));
const skill = fs.readFileSync("plugins/claude-code-advisor/skills/claude/SKILL.md", "utf8");

assert.equal(manifest.name, "claude-code-advisor");
assert.equal(manifest.skills, "./skills/");
assert.ok(manifest.interface?.displayName);
assert.ok(marketplace.plugins.some((plugin) => plugin.name === "claude-code-advisor"));
assert.match(skill, /^---\nname: claude\n/m);
assert.match(skill, /claude-companion\.mjs/);

console.log("plugin metadata ok");
