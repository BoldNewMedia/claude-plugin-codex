# Changelog

All notable public changes to Claude Code Advisor for Codex are recorded here.

## 0.1.17 - 2026-09-06

- diagnose authentication in the invoking process and bound the tool-free
  readiness probe, with clear host-sandbox guidance
- publish foreground review findings only after successful provider-envelope,
  session and findings validation, retry invalid formatting once, and prevent
  failed reviews from falling back to background execution
- withhold unproven historical review results across public readback while
  preserving stored evidence and fixed, non-disclosing failure explanations
- require validated review authority before resume and align review and
  non-review resume discovery with the resolver
- reject `--write` for review commands before side effects
- return a nonzero exit for failed foreground advice, prepared tasks and rescue,
  including resumed jobs, while preserving successful background-launch exits
- make alpha reports optional, align release metadata and strengthen setup,
  routing, review, resume and lifecycle regression coverage
- verify the updated failure exit contract in Codex routing checks without
  confusing unavailable nested authentication with authenticated success

## 0.1.16 - 2026-09-04

- give an automatic foreground-timeout fallback the normal 10-minute
  supervised background deadline instead of 30 seconds
- retain fixed, non-disclosing supervisor failure classifications for known
  worker, provider-start and control-socket events, with `worker-failure` kept
  only as the unknown fallback

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
