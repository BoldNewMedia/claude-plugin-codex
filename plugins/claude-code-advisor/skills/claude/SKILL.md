---
name: claude
description: >
  Use when the user asks Codex to consult Claude Code, run a Claude advisor
  pass, get a Claude adversarial review, check a plan or diff with Claude,
  ask Claude to rescue or continue a task, inspect Claude advisor job status,
  fetch a Claude result, or cancel a Claude advisor job. This skill routes through the bundled
  claude-companion.mjs runtime; it does not call the Claude CLI directly.
---

# Claude Code Advisor

Use this skill to route Codex work to the local Claude Code CLI through the
bundled companion runtime. Codex remains the orchestrator. Claude Code is the
advisor, checker, or reviewer.

## Invocation Contract

Canonical forms:

```text
$claude setup
$claude advise <question>
$claude rescue [--background] [--write] [--resume] <task>
$claude review [--base <ref>]
$claude adversarial-review [--base <ref>] [focus]
$claude status [job-id]
$claude result [job-id]
$claude cancel [job-id]
$claude resume-candidate
```

If Codex passes slash-style text through to this skill, normalize it before
routing:

```text
/claude <subcommand> <args> -> $claude <subcommand> <args>
/claude:setup -> $claude setup
/claude:advise <question> -> $claude advise <question>
/claude:rescue <task> -> $claude rescue <task>
/claude:review [--base <ref>] -> $claude review [--base <ref>]
/claude:adversarial-review [focus] -> $claude adversarial-review [focus]
/claude:status [job-id] -> $claude status [job-id]
/claude:result [job-id] -> $claude result [job-id]
/claude:cancel [job-id] -> $claude cancel [job-id]
```

Do not add or depend on undocumented plugin manifest fields for custom slash
commands. The guaranteed Codex surface is the `$claude` skill mention.

## Hard Rules

- Always call the bundled companion at `<plugin root>/scripts/claude-companion.mjs`
  using an absolute path. The plugin root is the `claude-code-advisor`
  directory that contains `.codex-plugin/`, `skills/`, and `scripts/`.
- Do not call `claude` directly from the skill instructions.
- Return companion output exactly unless the user asks for a summary.
- Review and adversarial-review are read-only.
- Write-capable Claude work requires explicit `--write`.
- Do not auto-resume a Claude job when the companion says explicit selection
  is required.

## Routing

- `setup`: run the companion setup command and show the result.
- `advise`: use for architecture questions, second opinions, and checker work.
- `rescue`: use for substantial task handoff, debugging, implementation help,
  or follow-up work. It is read-only unless `--write` is explicit.
- `review`: use for ordinary read-only review of local git state.
- `adversarial-review`: use for challenge reviews, plan attacks, and harness
  checker passes.
- `status`, `result`, `cancel`: use for managed Claude jobs only.
- `resume-candidate`: use before follow-up work when the user did not provide a
  job id and the request sounds like "continue", "resume", or "dig deeper".

## Commands

When invoked, map the user request to one companion call:

```bash
node "<plugin root>/scripts/claude-companion.mjs" <subcommand> <args>
```

Examples:

```bash
node "<plugin root>/scripts/claude-companion.mjs" setup --json
node "<plugin root>/scripts/claude-companion.mjs" adversarial-review --base main --json
node "<plugin root>/scripts/claude-companion.mjs" status --json
```
