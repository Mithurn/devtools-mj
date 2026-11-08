#!/bin/sh
set -eu
WS="${ECO_WS:-$HOME/Developer/outboxlabs-work}"
USAGE="usage: ticket-worktree.sh new <repo> <short-name> [base=main]   branch mithurn/<short-name> in $WS/<repo>-<short-name>
       ticket-worktree.sh rm <repo> <short-name>
       short-name: lowercase words and dashes, readable, never a ClickUp ID (add -staging for a staging PR from a staging base)"

cmd="${1:-}"; repo="${2:-}"; name="${3:-}"; base="${4:-main}"
[ -n "$cmd" ] && [ -n "$repo" ] && [ -n "$name" ] || { echo "$USAGE"; exit 1; }
main="$WS/$repo"; wt="$WS/$repo-$name"; branch="mithurn/$name"
[ -d "$main/.git" ] || { echo "no repo at $main"; exit 1; }
printf '%s' "$name" | grep -Eq '^[a-z][a-z0-9-]{2,60}$' || { echo "bad short name: $name"; exit 1; }
printf '%s' "$name" | grep -Eiq '(^|-)(cu-[a-z0-9]+|14ze[a-z0-9]{6,}|86[a-z0-9]{7,9})($|-)' && { echo "short name must not contain a ClickUp ID"; exit 1; }

case "$cmd" in
  new)
    [ -e "$wt" ] && { echo "$wt already exists"; exit 1; }
    git -C "$main" fetch -q origin "$base"
    git -C "$main" worktree add -q -b "$branch" "$wt" "origin/$base"
    for f in .env .env.local; do [ -f "$main/$f" ] && ln -s "$main/$f" "$wt/$f"; done
    [ -d "$main/node_modules" ] && ln -s "$main/node_modules" "$wt/node_modules"
    mkdir -p "$wt/.claude"
    ln -sfn "$WS/.claude/settings.json" "$wt/.claude/settings.local.json"
    for d in skills agents; do [ -d "$wt/.claude/$d" ] || ln -sfn "$WS/.claude/$d" "$wt/.claude/$d"; done
    gitdir="$(git -C "$wt" rev-parse --git-common-dir)"
    for e in ".env" ".env.local" "node_modules" ".claude/settings.local.json" ".claude/skills" ".claude/agents"; do grep -qxF "$e" "$gitdir/info/exclude" 2>/dev/null || echo "$e" >> "$gitdir/info/exclude"; done
    echo "worktree: $wt"
    echo "branch:   $branch (from origin/$base)"
    echo "next:     cd $wt, then contract use <ticket> (contract repos should list $repo-$name or $repo)"
    ;;
  rm)
    [ -d "$wt" ] || { echo "no worktree at $wt"; exit 1; }
    [ -z "$(git -C "$wt" status --porcelain)" ] || { echo "worktree has uncommitted changes, not removing"; exit 1; }
    rm -f "$wt/.env" "$wt/.env.local" "$wt/node_modules"
    git -C "$main" worktree remove "$wt"
    echo "removed $wt (branch $branch kept, delete it with git branch -D when merged)"
    ;;
  *) echo "$USAGE"; exit 1 ;;
esac
