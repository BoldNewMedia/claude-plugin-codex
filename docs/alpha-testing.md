# Alpha testing

We are seeking a small group of developers who already use both Codex and
Claude Code. The goal is to verify installation, first-review success and
cross-platform reliability before beta.

## Suitable testers

You should have:

- a supported local Codex installation with plugin marketplace support
- a supported, authenticated local Claude Code CLI
- Node.js 18.18 or newer
- a non-sensitive Git repository where you can run a read-only review

Windows and Linux reports are especially useful because the live workflow has
so far been verified primarily on macOS.

## Fifteen-minute test

1. Install the marketplace and plugin using the [README](../README.md).
2. Start a new Codex task.
3. Run `$claude setup`.
4. In a repository with staged or tracked changes, run `$claude review` or
   `$claude adversarial-review --base main`.
5. Decide whether the result found, confirmed or changed an engineering
   decision.
6. Report the outcome using the GitHub bug form or the alpha feedback issue.

Do not use confidential code for the first test. The plugin is alpha software,
and prompts and selected repository content are processed through your local
Claude Code account.

## What to report

- operating system and architecture
- Codex, Claude Code, Node.js and plugin versions
- setup success or failure
- first-review success or failure
- approximate minutes from installation to the first result
- whether the result was useful, a false positive or inconclusive
- the smallest sanitised error or reproduction when something failed

Never provide credentials, session data, private source code, personal
information, full environment dumps or unsanitised paths.

## Success criteria

The beta decision will use the following evidence:

- at least 10 external installations
- at least 80% setup success
- at least 70% successful first reviews
- median time to first useful result below 10 minutes
- no unresolved recurring permission or background lifecycle defect
- repeat use by at least five testers in a second week

The project does not add phone-home analytics for this programme. Results are
collected only from information testers choose to report.
