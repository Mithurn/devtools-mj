# ecosystem

How the workspace is wired, and how to rebuild it on a new laptop.

## Daily use

| Need | Tool | Notes |
| --- | --- | --- |
| Find a job by any ID, email or error on the prod Bull Boards | `.claude/bin/bbs find <value>` | Clavis first, then Zapmail BE, then automation. Prints job links. Index keeps 3 days. |
| Query prod, staging or local databases | `db-*` MCP servers (`tools/dbhub`) | Read only. Start from `notes/data-map.md`. |
| Load staging secrets | `ecosystem/pj.mjs keys\|diff\|run --env staging --project <repo>` | Replaces `pandora-jar` while the server lacks the v4 API. Production blocked. |
| Zapmail admin panel | Claude in Chrome, "Claude" profile | Read-only pages only. |
| Refresh board access | paste fresh `bull_board_token` cookies in `~/.config/devtools-mj/.env` | Expire about daily. |

## Workflow scripts

| Script | Purpose |
| --- | --- |
| `gate.mjs`, `rules.mjs` | Claude Code hook: push, PR, merge, commit text, branch names, protected branches, migrations, deploys, read-only SQL, contract and completion gates. Tests: `node --test ecosystem/*.test.mjs` |
| `audit.mjs` | Append-only audit log of tool calls |
| `evidence.mjs` | Screenshots of local apps, dry-run-by-default `gh pr edit --attach` |
| `ticket-worktree.sh` | One isolated worktree and branch `mithurn/<short-name>` per ticket |
| `dbhub-readonly-check.mjs` | Proves DBHub refuses writes, local database only |
| `pj.mjs` | Staging secrets through the older Pandora Jar API, production blocked |
| `secrets.sh`, `bootstrap.sh` | Encrypted backup and new-laptop setup |

## What lives where

- Tools and scripts: this repo (`tools/`, `ecosystem/`).
- Claude behaviour: workspace `CLAUDE.md`, `.claude/` (skills, rules, bin), `notes/data-map.md`, global `~/.claude`, memory. None of it is in a git remote.
- Secrets: `~/.config/devtools-mj/.env`, repo `.env` files, `.keys/`. Never committed.
- Team secrets source of truth: Pandora Jar (`https://pandora-jar.outbox.vc`, projects `clavis` and `Zapmail Backend`).

## Backup and rebuild

- `ecosystem/secrets.sh backup` writes one passphrase-encrypted tarball of everything above that no remote holds (default `~/Library/Mobile Documents/com~apple~CloudDocs/devtools-mj-backup/`). Run it after meaningful changes.
- New laptop: install Homebrew, clone this repo, run `ecosystem/bootstrap.sh`. It installs tools, clones the repos in `repos.txt`, restores the latest backup, builds the tools and links Claude config, then prints the manual steps (logins, VPN, Chrome profile). `--check` shows what it would do.
- Not verified on a fresh machine yet.
