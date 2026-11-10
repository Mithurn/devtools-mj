#!/bin/sh
set -e
[ $# -ge 2 ] || { echo "usage: run-ts.sh <worktree> <script.ts> [args]" >&2; exit 1; }
WT=$(cd "$1" && pwd); SCRIPT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2
[ -d "$WT/node_modules" ] || { echo "no node_modules in $WT, run the install there first" >&2; exit 1; }
cd "$WT"
NODE_PATH="$WT/node_modules" exec npx ts-node --transpile-only -P "$WT/tsconfig.json" "$SCRIPT" "$@"
