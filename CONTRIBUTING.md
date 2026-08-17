# Contributing

Contributions that improve reliability, safety, documentation and compatibility
are welcome.

## Before starting

- Search existing issues and pull requests.
- Open an issue before a substantial change so the scope can be agreed first.
- Keep changes focused. Separate unrelated fixes.
- Do not include credentials, tokens, private prompts, private source code or
  personal information in issues, tests, fixtures or commits.
- Report security vulnerabilities using [SECURITY.md](SECURITY.md), not a
  public issue.

## Development

Requirements:

- Node.js 18.18 or newer
- Codex with plugin marketplace support for end-to-end testing
- a locally installed and authenticated Claude Code CLI for smoke testing

Run the standard validation before submitting a pull request:

```bash
npm run validate
```

If the change affects Claude CLI invocation, runtime behaviour or installation
instructions, also run:

```bash
npm run test:smoke
```

If the change affects Codex routing, skill instructions or public installation,
also run:

```bash
npm run test:e2e:codex
```

State which checks you ran and explain any check you could not run. Sanitise all
diagnostic output before sharing it.

## Pull requests

- Link the relevant issue where one exists.
- Explain the problem, the chosen approach and user-visible effects.
- Add or update tests for behaviour changes.
- Preserve the MIT licence and original Yanchuk attribution.
- Keep public copy clear that this is an unofficial community project, not an
  Anthropic or OpenAI product.
- Avoid adding dependencies unless their benefit justifies the maintenance and
  security cost.

By contributing, you agree that your contribution is licensed under the
project's [MIT licence](LICENSE).
