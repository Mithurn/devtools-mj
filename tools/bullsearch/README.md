# bullsearch

Find BullMQ jobs by any text in the job (email, user ID, mailbox ID, job ID) or in its failed reason, across all queues and states, in seconds.

## Why

Bull Board has no search. The previous helper paged every queue and state through the Bull Board HTTP API, 1000 jobs per request, and matched on the client. That is slow because of the HTTP paging, not because of Redis.

## Design

- Talks to Redis directly with read-only commands. No app changes, no new infra, no Redis modules, nothing written to Redis.
- One connection per board. Works on any board that exposes its Redis, so Clavis and Zapmail share one tool.
- Flow:
  1. Discover queues: `SCAN MATCH <prefix>:*:meta`.
  2. Per queue, read job IDs from the state keys in one pipeline: `ZRANGE` for `completed`, `failed`, `delayed`, `prioritized`, `waiting-children`; `LRANGE` for `wait`, `active`, `paused`.
  3. Pipeline `HMGET <prefix>:<queue>:<id> name data failedReason timestamp finishedOn` in batches.
  4. Case-insensitive substring match over `id`, `data` and `failedReason`. Multiple terms are OR.
- Output is human readable lines, or JSON lines with `--json` so scripts and agents can parse it. Emails in failed reasons are masked unless `--raw`. Job `data` is never printed.
- Layering: `config` (env to board settings), `scan` (Redis reads), `search` (pure matching and formatting), `cli` (args and output). Only `scan` touches Redis, so the rest is unit-tested without it.

## Config

One Redis URL per board, from env vars. Board name `clavis` becomes `BULLSEARCH_CLAVIS_REDIS_URL`; `-` in a name becomes `_`.

```
BULLSEARCH_CLAVIS_REDIS_URL=redis://user:pass@host:6379/1
BULLSEARCH_CLAVIS_PREFIX=bull            # optional, default bull
BULLSEARCH_DEFAULT_BOARD=clavis          # optional
```

Put them in `~/.config/devtools-mj/.env`, or point `BULLSEARCH_ENV_FILE` at another file. Use a read-only Redis user (`+@read`) for the URL. Use `rediss://` for TLS. Redis DB index goes in the URL path (Clavis prod uses DB 1).

## Usage

```
bullsearch doctor [--board b]                       Redis version, modules, queues found, key layout check
bullsearch queues [--board b]                       Queues with job counts per state
bullsearch find <term[,term]|-> [queue ...]         Search; `-` reads terms from stdin
    --board b  --state failed,completed  --limit 200  --json  --raw
```

## Limits

- Cost grows with retained jobs (`removeOnComplete` and `removeOnFail` cap how far back any search can see). Only a sidecar that records events outlives retention.
- Needs network access to Redis (Netbird or VPN for Outbox hosts).
- The Redis key layout assumed is BullMQ v5. `doctor` checks it.

## Later, only if needed

- RediSearch index when a board's Redis ships the module, for millisecond queries.
- `QueueEvents` sidecar for history beyond retention.
- MCP wrapper so agents call it as a tool (agents can already run the CLI).
- Per-queue log outcome extraction (`provider outcome` lines in `:logs`).
