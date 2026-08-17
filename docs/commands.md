# Claude Code Advisor cheat sheet

Use these commands in a Codex chat, not in Terminal.

Claude Code Advisor for Codex is an unofficial, community-maintained
integration. It is not endorsed by or affiliated with OpenAI or Anthropic.

For installation, compatibility and privacy information, see the main
[README](../README.md).

The reliable invocation is `$claude`. You can also type `@`, select **Claude Code Advisor**, and then enter a `$claude` command. Slash forms are best-effort aliases only.

## Quick picker

| Need | Command |
|---|---|
| Check installation and login | `$claude setup` |
| Get a second opinion | `$claude advise <question>` |
| Give Claude a specific prepared task | `$claude do <prepared task>` |
| Hand off deeper debugging | `$claude rescue <task>` |
| Review the current Git changes | `$claude review` |
| Challenge assumptions or hidden risks | `$claude adversarial-review [focus]` |
| Watch a background job | `$claude monitor <job-id>` |
| Check job state | `$claude status [job-id]` |
| Retrieve a job result | `$claude result <job-id>` |
| Stop a background job | `$claude cancel <job-id>` |
| Find a safe job to continue | `$claude resume-candidate` |

## Complete syntax

```text
$claude setup [--json]
$claude advise [--background] [--write] [--max-turns <n>] [--effort <level>] [--allow-mcp] [--allow-web] [--no-background-fallback] [prompt]
$claude do [--background] [--write] [--model <model>] [--max-turns <n>] [--effort <level>] [--allow-mcp] [--allow-web] [prompt]
$claude rescue [--background] [--write] [--resume] [--model <model>] [--max-turns <n>] [--effort <level>] [--allow-mcp] [--allow-web] [--no-background-fallback] [prompt]
$claude review [--base <ref>] [--max-turns <n>] [--effort <level>] [--json]
$claude adversarial-review [--base <ref>] [--max-turns <n>] [--effort <level>] [focus] [--json]
$claude monitor [job-id] [--interval-ms <ms>] [--max-checks <n>] [--stale-after-ms <ms>] [--json]
$claude status [job-id] [--watch] [--json]
$claude result [job-id] [--json]
$claude cancel [job-id] [--json]
$claude resume-candidate [--json]
```

Codex normally manages `--effort`, monitoring intervals and JSON output. Use the simpler forms elsewhere in this sheet unless you have a specific reason to override them.

## Invocation

Explicitly select the plugin and run a command:

```text
@Claude Code Advisor $claude advise Check this architecture for hidden failure modes.
```

Once the plugin is available, the skill command alone is sufficient:

```text
$claude advise Check this architecture for hidden failure modes.
```

## Commands

### `setup`

Checks Node.js, Claude Code version, authentication and required capabilities.

```text
$claude setup
```

### `advise`

Use for architecture questions, trade-offs, second opinions and evidence checks.

```text
$claude advise [--background] [--write] [--max-turns <n>] <question>
```

Examples:

```text
$claude advise Should this queue use at-least-once or exactly-once delivery?
$claude advise --background Review this migration plan for data-loss risks.
```

`advise` can use web tools. It is read-only unless `--write` is explicit.

### `do`

Use for a specific, prepared coding, exploration, scout, verifier, review or synthesis task.

```text
$claude do [--background] [--write] [--model sonnet|opus] [--max-turns <n>] <prepared task>
```

Examples:

```text
$claude do --background --model opus Inspect the authentication flow, cite exact files and report only.
$claude do --background --write --model opus Implement the approved fix within src/auth and run npm test.
```

Use Sonnet only for a tightly bounded junior-agent task. A prepared Sonnet prompt must state:

```text
Role: <scout | verifier | reviewer | synthesis | hands>
Word cap: <400-600 words unless coding output requires otherwise>
Targets: <absolute paths or pinned commit>
What Must Be True:
- <falsifiable invariant>
Known Constraints:
- <rules, permissions and dependency limits>
Mechanical Verification:
- <exact verification command or PASS/FAIL condition>
Stop Conditions:
- <when Claude must stop instead of guessing>
```

Use Opus for ambiguous debugging, broad refactors, architecture, authentication, money, migrations, personal information, provider reliability and other high-judgement work.

### `rescue`

Use for substantial debugging, a stalled task or deeper implementation help.

```text
$claude rescue [--background] [--write] [--resume] [--model sonnet|opus] [--max-turns <n>] <task>
```

Examples:

```text
$claude rescue --background --model opus Diagnose the flaky integration test and report the root cause.
$claude rescue --background --write --model opus Fix the confirmed race condition and run the relevant tests.
$claude rescue --resume --background Continue the selected Claude job from its saved state.
```

`rescue` is read-only unless `--write` is explicit.

### `review`

Runs a short, structured, read-only review of local Git state.

```text
$claude review [--base <ref>]
```

Examples:

```text
$claude review
$claude review --base main
```

Untracked files are not present in a Git diff. Stage intended new files before relying on structured review.

### `adversarial-review`

Challenges a plan or diff and looks for hidden assumptions, failure modes and regressions. It is always read-only.

```text
$claude adversarial-review [--base <ref>] [focus]
```

Examples:

```text
$claude adversarial-review --base main
$claude adversarial-review --base main Focus on authentication bypass and data loss.
```

### `monitor`

Polls logs and agent state for a managed background job.

```text
$claude monitor [job-id]
```

Example:

```text
$claude monitor claude-job-123
```

The normal monitor interval is 30 seconds. It reports active, stale or finished state and the latest meaningful output.

### `status`

Shows the state of one job or the current workspace's managed jobs.

```text
$claude status [job-id]
```

Examples:

```text
$claude status
$claude status claude-job-123
```

### `result`

Returns the saved result for a managed job.

```text
$claude result <job-id>
```

### `cancel`

Stops a managed background job. Saved output may still be recoverable with `result`.

```text
$claude cancel <job-id>
```

### `resume-candidate`

Finds a safe candidate when you ask to continue but do not have a job ID.

```text
$claude resume-candidate
```

Do not resume automatically if more than one candidate requires explicit selection.

## Background-job workflow

```text
$claude advise --background Review this rollout plan for failure modes.
$claude monitor <job-id>
$claude status <job-id>
$claude result <job-id>
```

To stop instead:

```text
$claude cancel <job-id>
```

Use background mode for substantial prompts, large context or work likely to take more than one short answer.

## Common flags

| Flag | Meaning |
|---|---|
| `--background` | Run as a managed background job and return a job ID. |
| `--write` | Explicitly allow Claude to change files. Omit it for read-only work. |
| `--model opus` | Use Opus for complex or high-judgement work. |
| `--model sonnet` | Use Sonnet only for a prepared, bounded junior-agent task. |
| `--max-turns <n>` | Override the default Claude turn budget. |
| `--base <ref>` | Compare a review against a Git reference such as `main`. |
| `--resume` | Continue a selected saved Claude job. |
| `--allow-web` | Permit web tools for a prepared `do` or `rescue` task. Use only when external sources are required. |
| `--allow-mcp` | Permit project MCP servers. Use only after explicit approval. |

Advanced companion flags normally managed by Codex include `--effort <level>`, `--no-background-fallback`, `--interval-ms <ms>`, `--max-checks <n>`, `--stale-after-ms <ms>`, `--watch` and `--json`.

## Safety rules

- `review` and `adversarial-review` are read-only.
- `advise`, `do` and `rescue` require explicit `--write` before Claude can modify files.
- Project MCP servers are isolated by default. Background mode refuses workspaces containing `.mcp.json` unless `--allow-mcp` is explicitly approved.
- Prepared local `do` and `rescue` tasks use local read tools by default. Add `--allow-web` only when the task genuinely needs external sources.
- Do not default ordinary advice or review work to Sonnet. Use the configured Claude model unless a specific model is justified.

## Slash aliases

These may work when the Codex UI passes slash-style text through to the skill, but `$claude` is the portable form.

| Alias | Reliable equivalent |
|---|---|
| `/claude setup` or `/claude:setup` | `$claude setup` |
| `/claude:advise <question>` | `$claude advise <question>` |
| `/claude:do <task>` | `$claude do <task>` |
| `/claude:rescue <task>` | `$claude rescue <task>` |
| `/claude:review [--base <ref>]` | `$claude review [--base <ref>]` |
| `/claude:adversarial-review [focus]` | `$claude adversarial-review [focus]` |
| `/claude:monitor [job-id]` | `$claude monitor [job-id]` |
| `/claude:status [job-id]` | `$claude status [job-id]` |
| `/claude:result <job-id>` | `$claude result <job-id>` |
| `/claude:cancel <job-id>` | `$claude cancel <job-id>` |

## Recommended defaults

```text
# Normal second pass
$claude review --base main

# Challenge a high-risk change
$claude adversarial-review --base main Focus on security, migrations and rollback.

# Substantive second opinion
$claude advise --background Check this plan against the evidence and identify unsupported assumptions.

# Deep read-only debugging
$claude rescue --background --model opus Diagnose the failure, cite evidence and do not modify files.

# Approved implementation
$claude do --background --write --model opus Implement the approved change within the stated paths and run the named verification commands.
```
