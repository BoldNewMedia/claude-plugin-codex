# Security policy

## Supported versions

This project is alpha software. Security fixes are applied to the latest
release and the current `main` branch only. Older releases are not supported.

## Reporting a vulnerability

Do not report a vulnerability in a public issue, discussion, pull request or
log.

Use GitHub's private vulnerability reporting form:

<https://github.com/BoldNewMedia/claude-plugin-codex/security/advisories/new>

If that form is unavailable, open a public issue containing only a request for
a private reporting channel. Do not include vulnerability details.

Include:

- the affected version or commit
- the operating system and relevant Codex, Claude Code and Node.js versions
- the smallest safe reproduction you can provide
- the expected and observed behaviour
- the likely impact and any suggested mitigation

Remove credentials, tokens, cookies, personal information, private source code
and other secrets from every report and attachment. Never provide a Claude,
Anthropic, OpenAI or other account credential.

The maintainers will assess reports on a best-effort basis. Please allow time
for a fix before public disclosure.

## Security boundaries

This plugin runs the locally installed `claude` CLI with the permissions of the
current user. It does not provide a security boundary around Claude Code,
Codex, the local repository or the operating system. Review prompts and
commands before running them, especially when enabling write access or MCP.

This is an unofficial community project. It is not affiliated with, endorsed
by or supported by Anthropic or OpenAI.
