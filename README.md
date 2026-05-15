# claude-plugin-codex

Use Claude Code from Codex as an advisor, checker, reviewer, or rescue worker.
Codex stays in charge of the thread; Claude Code gives a second pass through
the local `claude` CLI.

This is the inverse of `openai/codex-plugin-cc`: instead of using Codex from
Claude Code, it uses the local Claude Code CLI from Codex through a managed
companion runtime.

## Status

Private alpha. The plugin is useful for local testing, but the Codex skill
surface is still being verified across Codex builds. Treat `/claude` as an
alias only if your Codex UI exposes it; the guaranteed v1 contract is explicit
skill mention with `$claude`.

## What You Get

- `$claude setup` checks whether Claude Code is installed, authenticated, and
  supports the CLI capabilities this plugin needs.
- `$claude advise` asks Claude for a lightweight second opinion.
- `$claude rescue` hands Claude a debugging or implementation task; it is
  read-only unless you pass `--write`.
- `$claude review` runs a structured read-only review of local git state.
- `$claude adversarial-review` asks Claude to challenge assumptions and design
  choices.
- `$claude status`, `$claude result`, and `$claude cancel` manage stored Claude
  jobs.

## Requirements

- Codex with plugin marketplace support.
- Claude Code installed and authenticated on the same machine.
- Node.js 18.18 or newer.

## Install Locally

From this repository:

```bash
codex plugin marketplace add ./
```

Then restart Codex and install `claude-code-advisor` from the plugin directory.

Check Claude Code readiness:

```text
$claude setup
```

## Usage

Use the explicit skill mention contract:

```text
$claude setup
$claude advise should this plan use a background worker?
$claude rescue --background investigate the flaky integration test
$claude rescue --write fix the failing test with the smallest safe patch
$claude review --base main
$claude adversarial-review challenge the state management assumptions
$claude status
$claude result <job-id>
$claude cancel <job-id>
```

If your Codex build shows enabled skills in the slash menu as `/claude`, that is
an alias for the same skill behavior.

## Safety

Review and adversarial review are read-only. `advise` and `rescue` are also
read-only unless `--write` is explicit. Write-capable Claude work is recorded as
a separate job type.

The companion runtime tracks jobs by workspace and Codex thread ID when Codex
provides one. If it cannot safely infer a thread, it requires an explicit job
ID before resuming work.

Claude Code must already be installed and authenticated on the host:

```bash
claude auth login
```

## How It Works

The `claude` skill is intentionally thin. It routes every request to:

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

## Current Limits

- The plugin depends on the installed Claude Code CLI contract. Run
  `$claude setup` after upgrading Claude Code.
- Background mode is optional. If the companion cannot verify `claude --bg`,
  `claude agents`, `claude logs`, `claude attach`, and `claude stop`, it
  degrades to foreground-only behavior.
- Structured review depends on Claude returning valid JSON inside the
  `--output-format json` result envelope. The companion validates and retries
  once before failing.

## License

MIT.
