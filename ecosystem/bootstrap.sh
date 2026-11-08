#!/bin/sh
set -eu
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
WS="${ECO_WS:-$HOME/Developer/outboxlabs-work}"
HERE="$(cd "$(dirname "$0")" && pwd)"
say() { printf '%s\n' "$*"; }
run() { if [ "$CHECK" = 1 ]; then say "would run: $*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

say "== tools"
for t in git gh node npm jq sqlite3 curl openssl; do have "$t" && say "ok   $t" || { say "MISSING $t"; run brew install "$t"; }; done
have infisical || { say "MISSING infisical"; run brew install infisical/get-cli/infisical; }
have pandora-jar || { say "MISSING pandora-jar"; run npm install -g pandora-jar; }
have netbird || say "MISSING netbird (brew install netbirdio/tap/netbird, then netbird up --setup-key <key>)"
have colima || say "optional: colima and docker for the local stack (brew install colima docker docker-compose)"

say "== repos into $WS"
run mkdir -p "$WS"
while read -r repo; do
  name="${repo#*/}"
  if [ -d "$WS/$name/.git" ]; then say "ok   $name"; else say "clone $repo"; run gh repo clone "$repo" "$WS/$name"; fi
done < "$HERE/repos.txt"

say "== secrets and workspace files"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/devtools-mj-backup}"
LATEST="$(ls -1t "$BACKUP_DIR"/outbox-ecosystem-*.tar.gz.enc 2>/dev/null | head -1 || true)"
if [ -n "$LATEST" ]; then say "latest backup: $LATEST"; run "$HERE/secrets.sh" restore "$LATEST"; else say "no backup found in $BACKUP_DIR (copy it over, then: ecosystem/secrets.sh restore <file>)"; fi

say "== build tools"
for t in bbsearch bullsearch; do
  d="$WS/devtools-mj/tools/$t"
  [ -d "$d" ] && { run sh -c "cd '$d' && npm ci --silent && npm run build --silent"; say "built $t"; }
done
[ -x "$WS/.claude/bin/link-repo" ] && for r in clavis zapmail-be zapmail-fe-nextjs zapbox-fe devtools-mj; do [ -d "$WS/$r" ] && run "$WS/.claude/bin/link-repo" "$r" || true; done

cat <<'TXT'

== do these by hand (cannot be scripted)
1. gh auth login
2. infisical login --domain https://pandora-jar.outbox.vc      (then: devtools-mj/ecosystem/pj.mjs keys --env staging --project <repo>)
3. netbird up --setup-key <key from your lead>, then: ping devops.netbird.cloud
4. Chrome: create the "Claude" profile, install the Claude extension, sign in to claude.ai, admin.zapmail.ai, app.zapmail.ai, automation.reachinbox.xyz and Google
5. Refresh the Bull Board cookies in ~/.config/devtools-mj/.env (BBSEARCH_ZAPMAIL_BE_COOKIE, BBSEARCH_AUTOMATION_COOKIE), then: .claude/bin/bbs sync
6. Start Claude Code from the workspace root and run /mcp to load the db-* servers
TXT
