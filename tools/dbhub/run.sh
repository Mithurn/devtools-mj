#!/bin/sh
SRC="${1:?usage: run.sh <source-id>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${DBHUB_ENV_FILE:-$HOME/.config/devtools-mj/.env}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
CFG="${TMPDIR:-/tmp}/dbhub-$SRC.toml"
awk -v id="$SRC" 'BEGIN{RS="";ORS="\n\n"} index($0,"id = \"" id "\"")||index($0,"source = \"" id "\"")' "$DIR/dbhub.toml" > "$CFG"
[ -s "$CFG" ] || { echo "unknown source $SRC" >&2; exit 1; }
exec npx -y @bytebase/dbhub@1.6.0 --config "$CFG"
