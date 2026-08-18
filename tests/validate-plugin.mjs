import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("plugins/claude-code-advisor/.codex-plugin/plugin.json", "utf8"));
const marketplace = JSON.parse(fs.readFileSync(".agents/plugins/marketplace.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const skill = fs.readFileSync("plugins/claude-code-advisor/skills/claude/SKILL.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const commands = fs.readFileSync("docs/commands.md", "utf8");
const e2e = fs.readFileSync("tests/e2e-codex-skill.mjs", "utf8");
const smoke = fs.readFileSync("tests/smoke-installed-tools.mjs", "utf8");
const companion = fs.readFileSync("plugins/claude-code-advisor/scripts/claude-companion.mjs", "utf8");
const supervisor = fs.readFileSync("plugins/claude-code-advisor/scripts/claude-supervisor.mjs", "utf8");
const groupWorker = fs.readFileSync("plugins/claude-code-advisor/scripts/claude-group-worker.mjs", "utf8");
const runtime = fs.readFileSync("plugins/claude-code-advisor/scripts/lib/runtime.mjs", "utf8");

assert.equal(manifest.name, "claude-code-advisor");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.interface?.displayName, "Claude Code Advisor");
assert.deepEqual(manifest.interface?.capabilities, ["Read", "Write"]);
assert.ok(manifest.interface?.defaultPrompt?.length <= 3);
assert.ok(manifest.interface.defaultPrompt.every((prompt) => prompt.length <= 128));
assert.equal(manifest.homepage, "https://github.com/BoldNewMedia/claude-plugin-codex");
assert.equal(manifest.repository, "https://github.com/BoldNewMedia/claude-plugin-codex");
assert.equal(manifest.interface?.developerName, "Bold New Media");
assert.equal(manifest.interface?.websiteURL, "https://github.com/BoldNewMedia/claude-plugin-codex");
assert.equal(manifest.interface?.privacyPolicyURL, "https://github.com/BoldNewMedia/claude-plugin-codex/blob/main/PRIVACY.md");
assert.equal(manifest.interface?.termsOfServiceURL, "https://github.com/BoldNewMedia/claude-plugin-codex/blob/main/TERMS.md");
assert.match(readme, /codex plugin marketplace add BoldNewMedia\/claude-plugin-codex/);
assert.match(readme, /codex plugin add claude-code-advisor@claude-plugin-codex/);
assert.match(readme, /maintained fork/);
assert.doesNotMatch(readme, /codex plugin marketplace add yanchuk\/claude-plugin-codex/);
assert.equal(marketplace.interface?.displayName, "Claude Code Advisor for Codex");
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/icon.svg"));
assert.ok(fs.existsSync("plugins/claude-code-advisor/assets/logo.svg"));
for (const publicPath of [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "TERMS.md",
  "docs/alpha-testing.md",
  "docs/commands.md",
  "docs/assets/social-preview.png",
  "docs/assets/claude-code-advisor-demo.png",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md",
]) {
  assert.ok(fs.existsSync(publicPath), `missing public-release file: ${publicPath}`);
}
assert.equal(fs.readlinkSync("CLAUDE.md"), "AGENTS.md");
assert.ok(marketplace.plugins.some((plugin) => plugin.name === "claude-code-advisor"));
assert.equal(packageJson.scripts["test:e2e:codex"], "node tests/e2e-codex-skill.mjs");
assert.ok(fs.existsSync("tests/e2e-codex-skill.mjs"));
assert.match(skill, /^---\nname: claude\n/m);
assert.match(skill, /claude-companion\.mjs/);
assert.match(skill, /\/claude:rescue/);
assert.match(skill, /\/claude:do/);
assert.match(skill, /tasks-for-sonnet/);
assert.match(skill, /\$claude do --model opus/);
assert.match(skill, /complex\/high-judgment/);
assert.match(skill, /What Must Be True/);
assert.match(skill, /Mechanical Verification/);
assert.match(skill, /\$claude monitor/);
assert.match(skill, /Do not pass `--model sonnet`/);
assert.match(skill, /`--effort xhigh`/);
assert.match(skill, /--stale-after-ms 120000/);
assert.match(skill, /--mcp-config/);
assert.match(skill, /--no-chrome/);
assert.match(skill, /--allow-mcp/);
assert.match(skill, /--allow-web/);
assert.match(skill, /Do not use project MCP servers/);
assert.match(skill, /Read,Glob,Grep/);
assert.match(skill, /automatically launches one supervised background job/);
assert.match(skill, /Plugin job IDs and supervisor lifecycle IDs are never passed to `--resume`/);
assert.match(skill, /`claude -p --output-format json`/);
assert.match(skill, /Never use\s+terminal logs or stderr as a result source/);
assert.match(skill, /diff exceeds 1 MiB/);
assert.match(readme, /--no-background-fallback/);
assert.match(readme, /--mcp-config/);
assert.match(readme, /--no-chrome/);
assert.match(readme, /--allow-mcp/);
assert.match(readme, /--allow-web/);
assert.match(readme, /ancestor directories/);
assert.match(readme, /Unable to load skill contents/);
assert.match(readme, /\$claude do/);
assert.match(readme, /tasks-for-sonnet/);
assert.match(readme, /\$claude do --model opus/);
assert.match(readme, /\$claude advise --model sonnet/);
assert.match(readme, /Web tools are denied unless `--allow-web` is explicit/);
assert.match(readme, /Malformed JSON and unsupported schema/);
assert.match(readme, /diff exceeds 1 MiB/);
assert.match(readme, /Supervised background mode currently requires macOS/);
assert.match(readme, /Abrupt supervisor `SIGKILL`/);
assert.match(commands, /Resume uses only a canonical full Claude session UUID/);
assert.match(commands, /exactly one schema-valid UTF-8 JSON document/);
assert.match(commands, /complete diff exceeds 1 MiB/);
assert.match(smoke, /mkdtempSync/);
assert.match(smoke, /randomUUID/);
assert.match(smoke, /verifyCompletedJob/);
assert.match(smoke, /verifyIdempotence/);
assert.match(smoke, /strictEnvelope/);
assert.match(smoke, /cleanupActiveJobs/);
assert.match(smoke, /resultAuthoritativeAt/);
assert.match(smoke, /canonicalSessionId/);
assert.match(smoke, /supervisorPaths/);
assert.match(smoke, /if \(cleanupVerified\)/);
assert.doesNotMatch(
  smoke,
  /console\.(?:log|error)\([^\n]*(?:firstNonce|secondNonce|thirdNonce|canonicalSessionId|jobId|stderr|stdout)/,
  "authenticated smoke must not print provider data or identifiers"
);
assert.match(smoke, /Authenticated smoke FAIL: \$\{cleanupVerified \? failureClassification : "cleanup-unverified"\}/);
assert.match(smoke, /Skipping authenticated background smoke/);
assert.match(companion, /spawn\(process\.execPath, \[supervisorScript\]/);
assert.doesNotMatch(companion, /runClaude\(\["(?:agents|logs|stop)"/);
assert.match(supervisor, /claude-group-worker\.mjs/);
assert.doesNotMatch(supervisor, /spawn\("claude"/);
assert.match(groupWorker, /spawn\("claude", config\.claudeArgs/);
assert.match(groupWorker, /stdio: \["pipe", "pipe", "pipe"\]/);
assert.match(groupWorker, /process\.kill\(-process\.pid, "SIGTERM"\)/);
assert.match(groupWorker, /process\.kill\(-process\.pid, "SIGKILL"\)/);
assert.match(runtime, /validateSupervisedClaudeResult/);
assert.match(runtime, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
assert.match(runtime, /SUPERVISED_PERSISTED_FIELDS/);
assert.match(e2e, /--model sonnet/);
assert.match(e2e, /"--sandbox", "workspace-write"/);
assert.match(smoke, /"--model", "sonnet"/);
assert.match(smoke, /env: \{ \.\.\.process\.env, CLAUDE_COMPANION_STATE_ROOT: stateRoot \}/);
assert.match(readme, /inherits the\s+invoking process environment/);
assert.match(e2e, /export function classifyRoutedOutput/);
assert.match(e2e, /export function renderE2eFailure/);
assert.doesNotMatch(e2e, /args\.join\(" "\)/);
assert.doesNotMatch(e2e, /aggregated_output\}`/);
assert.doesNotMatch(e2e, /unexpected companion result:\\n\$\{routedOutput\}/);

console.log("plugin metadata ok");
