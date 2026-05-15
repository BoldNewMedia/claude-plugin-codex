# claude-plugin-codex

Use local Claude Code from Codex for advice, reviews, adversarial checks, and
rescue tasks. Codex stays in charge of the thread; Claude Code gives a second
pass through the local `claude` CLI.

This is the inverse of `openai/codex-plugin-cc`: instead of using Codex from
Claude Code, it uses the local Claude Code CLI from Codex through a managed
companion runtime.

## Status

Alpha. The plugin is useful for local testing, and the Codex marketplace flow
has been verified with Codex CLI `0.130.0`. Treat `/claude` as an alias only if
your Codex UI exposes it; the guaranteed v1 contract is explicit skill mention
with `$claude`.

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

From GitHub:

```bash
codex plugin marketplace add yanchuk/claude-plugin-codex
```

From this repository:

```bash
codex plugin marketplace add ./
```

Then open Codex's plugin directory, find the `Claude Plugin Codex`
marketplace, and install `Claude Code Advisor`.

After installation, new Codex sessions should load the skill as
`claude-code-advisor:claude`. Codex writes an enabled plugin entry similar to:

```toml
[plugins."claude-code-advisor@claude-plugin-codex"]
enabled = true
```

Check Claude Code readiness:

```text
$claude setup
```

If Codex was already running when you added or installed the marketplace, start
a new Codex thread or restart Codex before testing `$claude setup`.

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

## Privacy

This plugin does not run a hosted service. It executes the local Claude Code CLI
on your machine. Prompts, file context, and command output sent to Claude Code
are handled by your local Claude Code installation and Anthropic account.

The plugin stores job metadata and results under your local Codex home directory
so `$claude status`, `$claude result`, and `$claude cancel` can work across
turns. It does not intentionally collect analytics, phone home, or send data to
the repository owner.

## Terms

This project is provided under the MIT License. You are responsible for your use
of Codex, Claude Code, and any data you choose to send through those tools.

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

Optional end-to-end smoke test against an installed Codex plugin:

```bash
npm run test:e2e:codex
```

This requires `codex plugin marketplace add ./`, `Claude Code Advisor`
installed from Codex's plugin directory, and Claude Code already logged in. It
starts a fresh `codex exec` session and verifies that `$claude setup` routes
through the installed skill.

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
