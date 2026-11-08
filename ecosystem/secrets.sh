#!/bin/sh
set -eu
ECO_HOME="${ECO_HOME:-$HOME}"
ECO_WS="${ECO_WS:-$ECO_HOME/Developer/outboxlabs-work}"
BACKUP_DIR="${BACKUP_DIR:-$ECO_HOME/Library/Mobile Documents/com~apple~CloudDocs/devtools-mj-backup}"
WS="${ECO_WS#"$ECO_HOME"/}"
MEMORY=".claude/projects/$(printf '%s' "$ECO_WS" | sed 's#/#-#g')/memory"

PATHS="
$WS/.keys
$WS/brain
$WS/notes
$WS/tasks
$WS/.claude
$WS/CLAUDE.md
$WS/Outbox.code-workspace
$WS/.mcp.json
$WS/clavis-stability-backlog.md
$WS/zapmail-be/.env
$WS/clavis/.env
$WS/zapmail-fe-nextjs/.env.local
$WS/zapbox-fe/.env.local
.config/devtools-mj
.claude/CLAUDE.md
.claude/settings.json
.claude/skills
$MEMORY
.zshrc
"

pass_args() {
  if [ -n "${ECO_PASSPHRASE:-}" ]; then echo "-pass env:ECO_PASSPHRASE"; fi
}

case "${1:-}" in
  backup)
    mkdir -p "$BACKUP_DIR"
    OUT="$BACKUP_DIR/outbox-ecosystem-$(date +%F).tar.gz.enc"
    LIST="$(mktemp)"
    for p in $PATHS; do [ -e "$ECO_HOME/$p" ] && echo "$p" >> "$LIST"; done
    tar -C "$ECO_HOME" -czf - -T "$LIST" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt $(pass_args) -out "$OUT"
    chmod 600 "$OUT"; rm -f "$LIST"
    echo "backup written: $OUT ($(wc -l < /dev/null) $(du -h "$OUT" | cut -f1))"
    ;;
  restore)
    FILE="${2:?usage: secrets.sh restore <file.tar.gz.enc>}"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 $(pass_args) -in "$FILE" | tar -C "$ECO_HOME" -xzf -
    echo "restored into $ECO_HOME"
    ;;
  list)
    FILE="${2:?usage: secrets.sh list <file.tar.gz.enc>}"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 $(pass_args) -in "$FILE" | tar -tzf - | head -60
    ;;
  *) echo "usage: secrets.sh backup | restore <file> | list <file>   (asks for the passphrase; BACKUP_DIR overrides the target)"; exit 1 ;;
esac
