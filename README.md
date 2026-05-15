# claude-plugin-codex

## Install

Add the public marketplace:

```bash
codex plugin marketplace add yanchuk/claude-plugin-codex
```

Then open Codex's plugin directory, find `Claude Plugin Codex`, and install
`Claude`.

Start a new Codex thread and verify the install:

```text
$claude setup
```

If Codex was already running, start a new thread or restart Codex before using
`$claude`.

## What It Is

Use local Claude Code from Codex for advice, reviews, adversarial checks, and
rescue tasks. Codex stays in charge of the thread; Claude Code gives a second
pass through the local `claude` CLI.

This is the inverse of `openai/codex-plugin-cc`: instead of using Codex from
Claude Code, it uses the local Claude Code CLI from Codex through a managed
companion runtime.

## Status

Alpha. The Codex marketplace flow has been verified with Codex CLI `0.130.0`.
The stable command form is `$claude`. If your Codex UI exposes the skill as
`/claude`, you can use that as an alias.

## Commands

- `$claude setup` checks whether Claude Code is installed, authenticated, and
  supports the needed CLI features.
- `$claude advise` asks Claude for a lightweight second opinion.
- `$claude rescue` hands Claude a debugging or implementation task. It is
  read-only unless you pass `--write`.
- `$claude review` runs a structured read-only review of local git state.
- `$claude adversarial-review` asks Claude to challenge a plan or diff.
- `$claude monitor` polls a background Claude job and reports whether Claude is
  active, stale, or finished.
- `$claude status`, `$claude result`, and `$claude cancel` manage Claude jobs.

Slash-style aliases are best-effort. Codex plugin manifests do not yet expose a
documented custom slash-command API, so `$claude` is the portable form. If your
Codex build passes slash-style text to skills, these forms map to the same
commands:

```text
/claude setup
/claude:advise should this plan use a background worker?
/claude:rescue --background investigate the flaky integration test
/claude:review --base main
/claude:adversarial-review challenge the state management assumptions
```

## Requirements

- Codex with plugin marketplace support.
- Claude Code installed and authenticated on the same machine.
- Node.js 18.18 or newer.

## Local Development

From a local checkout:

```bash
codex plugin marketplace add ./
```

After installation, new Codex sessions should load the skill as
`claude-code-advisor:claude`. Codex writes an enabled plugin entry similar to:

```toml
[plugins."claude-code-advisor@claude-plugin-codex"]
enabled = true
```

## Usage

Use `$claude` in a Codex thread:

```text
$claude setup
$claude advise should this plan use a background worker?
$claude rescue --background investigate the flaky integration test
$claude monitor <job-id>
$claude rescue --write fix the failing test with the smallest safe patch
$claude review --base main
$claude adversarial-review challenge the state management assumptions
$claude status
$claude result <job-id>
$claude cancel <job-id>
```

If your Codex build shows `/claude` in the slash menu, it is an alias for the
same skill.

## Monitoring

Use background mode when Claude may need more than one short answer:

```text
$claude rescue --background investigate the flaky integration test
$claude monitor <job-id>
```

The monitor checks Claude every 30 seconds by default. It keeps raw logs in
JSON output, but the human view shows the useful signal: whether Claude is
active, the last meaningful line, how long output has been stale, and what to
do next.

## Safety

Review and adversarial review are read-only. `advise` and `rescue` are also
read-only unless you pass `--write`. Write-capable Claude work is recorded as a
separate job type.

The plugin does not force Sonnet for advisor, review, adversarial-review, or
rescue work. It lets Claude Code use your configured default model unless you
explicitly pass another model. It uses xhigh effort by default for Claude
advisor work. Sonnet belongs in junior-agent delegation workflows, not in the
default advisor path.

The companion runtime tracks jobs by workspace and Codex thread ID when Codex
provides one. If it cannot safely infer a thread, it requires an explicit job
ID before resuming work.

Claude Code must already be installed and authenticated on the host:

```bash
claude auth login
```

## Privacy

This plugin does not run a hosted service. It runs the local Claude Code CLI on
your machine. Your local Claude Code installation and Anthropic account handle
prompts, file context, and command output sent to Claude Code.

The plugin stores job metadata and results under your local Codex home directory
so `$claude status`, `$claude result`, and `$claude cancel` can work across
turns. It does not intentionally collect analytics, phone home, or send data to
the repository owner.

## Terms

This project is provided under the MIT License. You are responsible for how you
use Codex, Claude Code, and any data you send through those tools.

## How It Works

The `claude` skill routes each request to:

```bash
node "<plugin root>/scripts/claude-companion.mjs" <subcommand> <args>
```

The companion owns:

- command parsing
- Claude CLI invocation
- capability detection
- job state
- foreground and background lifecycle
- review JSON validation
- safety boundaries for read-only versus write-capable work

## Development

```bash
npm test
npm run validate
```

Optional smoke test against the installed Claude CLI:

```bash
npm run test:smoke
CLAUDE_PLUGIN_CODEX_RUN_BG_SMOKE=1 npm run test:smoke
```

Optional end-to-end smoke test against an installed Codex plugin:

```bash
npm run test:e2e:codex
```

This requires `codex plugin marketplace add ./`, `Claude` installed from
Codex's plugin directory, and a logged-in Claude Code CLI. It starts a fresh
`codex exec` session and verifies that `$claude advise --model sonnet` routes
through the installed skill. Sonnet is used only for this small routing test.

## Current Limits

- The plugin depends on the installed Claude Code CLI contract. Run
  `$claude setup` after upgrading Claude Code.
- Background mode is optional. If the companion cannot verify `claude --bg`,
  `claude agents`, `claude logs`, `claude attach`, and `claude stop`, it
  degrades to foreground-only behavior.
- `$claude monitor` checks a background job every 30 seconds by default. It
  reads `claude logs` and `claude agents`, filters routine terminal noise, and
  marks repeated output as stale after two minutes.
- Structured review depends on Claude returning valid JSON inside the
  `--output-format json` result envelope. The companion validates and retries
  once before failing.

## Troubleshooting

If Codex shows `Unable to load skill contents` after an update, restart Codex
or start a new thread. Codex may still point at an older cached skill path after
a plugin version bump. If the error remains, remove and reinstall the
`claude-plugin-codex` marketplace.

## License

MIT.
