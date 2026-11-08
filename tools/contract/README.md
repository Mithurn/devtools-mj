# contract

A per-ticket task contract that makes "done" checkable, plus the gate that enforces it.

- `contract.mjs new <ticket> <title>` creates `tasks/contracts/<ticket>.json` (draft) and makes it the active contract. `use`, `show`, `run`, `confirm`, `approve` and `status` do the rest.
- A contract has `scope`, `outOfScope`, `assumptions`, `openQuestions`, optional `repos`, and `items`. An item is a shell `verify` command (exit 0 means done, run from `cwd`) or `manual: true`, confirmed with a note.
- `approve` is the human step. It refuses while open questions are unanswered or there are no items.
- `ecosystem/gate.mjs` runs as a Claude Code hook:
  - blocks `git push` and `gh pr create` while the active contract is a draft or any item lacks fresh passing evidence (4 hours);
  - blocks finishing a turn on an approved but incomplete contract (Stop hook);
  - refuses non-SELECT SQL on the `db-*` tools;
  - lints commit messages and PR text: no em dashes, no Claude attribution, conventional PR title, no PR headers.
- `ecosystem/audit.mjs` appends every tool call to `~/.config/devtools-mj/audit.jsonl` with long tokens redacted.
- With no active contract the gate only warns, so unticketed work is not blocked. Remove `tasks/contracts/ACTIVE` to deactivate. A contract with `repos` only applies inside those repos.
- Tests: `node --test ecosystem/gate.test.mjs`.
