# Privacy policy

Effective 18 August 2026

This policy applies to Claude Code Advisor for Codex, maintained by Bold New
Media. The plugin is an unofficial community project and is not affiliated with
OpenAI or Anthropic.

## Summary

The plugin runs locally. Bold New Media does not operate a hosted service for
the plugin, receive plugin prompts or results, collect analytics, or receive
Claude Code credentials.

## Data the plugin handles

When you invoke the plugin, it may handle:

- the task prompt and options you provide
- local file content, Git diffs, file paths and repository metadata needed for
  the requested review or task
- Claude Code output and command status
- local job metadata, including job identifiers, timestamps, workspace paths
  and saved results

The exact content depends on the command and permissions you approve.

## Purpose and processing

The plugin uses this information only to run the requested Claude Code task,
validate or display its result, and manage foreground or background job state.

The plugin invokes the official Claude Code CLI installed and authenticated on
your machine. Content supplied to Claude Code is processed under your Anthropic
account and Anthropic's applicable terms and privacy policy. Your Codex host may
also process conversation and tool-call content under your OpenAI agreement.

Bold New Media is not a recipient of this content through the plugin.

## Credentials

The plugin does not request, copy or store your Claude Code password, token or
session credentials. Authentication remains controlled by the installed Claude
Code CLI.

## Local storage and retention

Job metadata and results are stored locally under
`~/.codex/claude-plugin-codex` unless you set
`CLAUDE_COMPANION_STATE_ROOT`. Stored content remains until it is overwritten
or you remove it. Removing the plugin does not necessarily remove this separate
state directory.

You control retention by choosing the state root and deleting saved state when
no plugin job is running. Treat the state directory as private because it can
contain prompts, results and local workspace paths.

## Telemetry and tracking

The plugin does not intentionally phone home, serve advertising, set tracking
cookies or collect usage analytics for Bold New Media.

GitHub may collect ordinary repository traffic when you visit or download the
public repository under GitHub's own policies.

## Your controls

You can:

- omit `--write` to keep supported task routes read-only
- omit `--allow-web` and `--allow-mcp` to keep those optional capabilities off
- inspect the source code and local state
- choose a separate local state root
- cancel managed jobs and remove saved local state
- uninstall the plugin at any time

## Changes and contact

Material changes will be recorded in the repository. For privacy or support
questions, follow [SUPPORT.md](SUPPORT.md). Do not post credentials, private
source code or personal information in a public GitHub issue.
