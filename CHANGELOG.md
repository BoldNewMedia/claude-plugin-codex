# Changelog

All notable public changes to Claude Code Advisor for Codex are recorded here.

## 0.1.15 - 2026-08-18

- replace provider-managed background and terminal-log result handling with a
  plugin-owned supervised `claude -p --output-format json` lifecycle on macOS
- accept only one bounded, valid UTF-8 provider result and enforce canonical
  session continuity for foreground and background resume
- transport prompts over standard input and keep prompts, raw output and
  process details out of persisted job state
- reject invalid monitor bounds before workspace or state access
- terminate owned process groups and remove control resources after worker
  exit, IPC loss, cancellation, timeout or output-limit failure
- preserve ambiguous legacy jobs and unsupported platforms as visible,
  fail-closed states instead of recovering authority from terminal logs

## 0.1.14 - 2026-08-18

- clarify the community-maintained product name and non-affiliation statement
- add direct CLI installation, update and removal instructions
- add compatibility status and beta exit criteria
- add public privacy, terms, security, support and contribution documentation
- add issue templates, pull request guidance and launch visual assets
- publish a concise command reference for users

## 0.1.13 - 2026-08-17

First release from the Bold New Media maintained fork.

- harden structured review extraction and validation
- include complete staged and base review diffs and reject unsafe untracked-file
  reviews
- improve background lifecycle monitoring, cancellation and result recovery
- isolate inherited MCP configuration for unattended work by default
- restrict local state directory and file permissions
- add sandbox-safe end-to-end Codex routing coverage
- verify deterministic tests and metadata on Node.js 20, 22 and 24

See the [v0.1.13 release](https://github.com/BoldNewMedia/claude-plugin-codex/releases/tag/v0.1.13)
for the published tag.
