# Harness Integration

Use Claude Code Advisor as a harness checker, not as the harness owner.

Recommended flow:

1. Codex writes the plan and validation contract.
2. Codex invokes `$claude adversarial-review` on the plan or diff.
3. Claude proposes findings with `BLOCKER`, `MAJOR`, or `MINOR` severity.
4. Codex adjudicates every finding with one of:
   - `accepted`
   - `rejected`
   - `needs-user-waiver`
5. Only unresolved adjudicated blockers require a user waiver.

Claude proposes severity. Codex owns disposition and implementation decisions.

Do not run write-capable Claude jobs as part of the harness unless the user
explicitly asks for `--write`.
