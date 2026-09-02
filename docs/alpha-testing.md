# Alpha testing

We are seeking developers who already use both Codex and Claude Code. The
current public release is
[`v0.1.15`](https://github.com/BoldNewMedia/claude-plugin-codex/releases/tag/v0.1.15).

Deterministic tests and Node.js 20, 22 and 24 CI passed at the exact release
commit. Authenticated Claude execution and installed Codex routing were not
rerun at that exact commit. This pilot is intended to collect that missing
independent end-to-end evidence without overstating what the release already
proves.

## Suitable testers

You should have:

- a supported local Codex installation with plugin marketplace support
- a supported, authenticated local Claude Code CLI
- Node.js 18.18 or newer
- a non-sensitive Git repository where you can run a read-only review

Do not install or pay for Claude Code only to test this plugin. This test is for
people who already have an authenticated Claude Code installation.

## Immediate three-person pilot

The immediate pilot needs three independent testers: one on native Windows,
one on Linux and one on macOS. A WSL report is useful as Linux and WSL evidence,
but it does not replace native Windows evidence.

The first tester can begin immediately. The ten-installation threshold below
is a beta exit criterion, not a prerequisite for recruiting or submitting the
first report.

## Fifteen-minute test

1. Install `v0.1.15` using the marketplace and plugin commands in the
   [README](../README.md).
2. Start a new Codex task.
3. Run `$claude setup`.
4. In a public or otherwise non-sensitive Git repository with a small tracked
   or staged change and no untracked files, run one foreground `$claude review`.
5. Submit the
   [structured alpha test report](https://github.com/BoldNewMedia/claude-plugin-codex/issues/new?template=alpha_test_report.yml),
   whether the result passed, failed or was inconclusive.

Use the foreground review route for this cross-platform pilot. Supervised
background mode currently requires macOS and is not part of this test.

GitHub requires you to sign in before you can submit an issue form. You do not
need collaborator access to the repository.

Do not use confidential code for the first test. The plugin is alpha software,
and prompts and selected repository content are processed through your local
Claude Code account.

## Reporting safety

The report form collects only the environment and outcome evidence needed for
the pilot: operating system, native Windows versus WSL, architecture, Codex,
Claude Code and Node.js versions, install, setup and review outcomes, elapsed
time, the smallest reproducible sanitised symptom, and optional usefulness
notes.

Never provide credentials, tokens, cookies, session data, private source code,
private prompts, personal information or full unsanitised logs. Do not use the
alpha form for a security vulnerability. Follow [SECURITY.md](../SECURITY.md)
and keep vulnerability details out of public issues.

## Beta exit criteria

These thresholds decide whether the project can leave alpha. They do not block
the pilot or the first tester:

- at least 10 external installations with completed submitted reports
- at least 80% setup success
- at least 70% successful first reviews
- median time to first useful result below 10 minutes
- no unresolved recurring permission or background lifecycle defect
- repeat use by at least five testers in a second week

The project does not add phone-home analytics for this programme. Results are
collected only from information testers choose to report.
