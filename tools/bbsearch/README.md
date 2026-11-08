# bbsearch

Search production Bull Board jobs by any value (email, user ID, export ID, mailbox ID, credential, error text) in milliseconds, using only the access you already have to the board.

## Why

Bull Board has no job search and its API returns one queue and state per call (about 1s per request, 500 jobs per page). Direct Redis would be faster but needs credentials most people do not have. bbsearch mirrors the board into a local SQLite file through the board's own read-only API, then searches the file.

## Design

- Source of truth stays the board. `sync` only issues GET requests to `<board>/api/queues`, three at a time with a short pause. It never writes, retries or replays jobs.
- `sync` lists every queue with its counts in one request, then per queue and state:
  - small states (`active`, `waiting`, `delayed`, `paused`, `prioritized`, `waiting-children`): fetched in full and replaced, so state changes show up.
  - `completed` and `failed`: paged newest first, stopping at the first page with nothing new or older than 3 days.
- The index keeps the full job data, the failed reason, state, queue and timestamps. It outlives BullMQ retention, so jobs the board already dropped stay searchable.
- `find` runs a case-insensitive substring match over job id, data and failed reason. Multiple terms are OR. Boards are searched in order and it stops at the first board with hits (`--all` keeps going).
- Every hit prints the Bull Board link `<board url>/queue/<queue>/<jobId>`.
- Layers: `config` (env), `api` (HTTP), `sync` (crawl), `store` (SQLite), `format` (output), `cli`. `sync` takes the API as a parameter, so tests run it against a fake.
- Zero runtime dependencies: `node:sqlite` and `fetch` (Node 22.13+).

## Config

`~/.config/devtools-mj/.env` (or `BBSEARCH_ENV_FILE`):

```
BBSEARCH_CLAVIS_URL=http://spare-machine.netbird.cloud:4015/ui
BBSEARCH_ZAPMAIL_BE_URL=https://app.zapmail.ai/api/v1/ui
BBSEARCH_ZAPMAIL_BE_COOKIE=bull_board_token=<jwt from your logged-in browser>
BBSEARCH_BOARDS=clavis,zapmail-be,automation
```

Board name `zapmail-be` maps to `BBSEARCH_ZAPMAIL_BE_*`. The cookie is only needed for boards behind login.

## Usage

```
bbsearch sync [--board a,b]            update the local index
bbsearch find <term[,term]|-> [--board a,b] [--all] [--state failed,completed] [--limit n] [--json] [--full] [--sync]
bbsearch job <queue> <jobId> [--board b]   full live job from the board (stacktrace included)
bbsearch status
```

## Limits

- The index file `~/.cache/devtools-mj/bbsearch.db` holds full job data, credentials included. It is readable only by you. Delete it when done.
- Jobs removed before the first sync cannot be recovered. State changes on old jobs show after the next sync. `find` warns when the index is over 15 minutes old.
- A first sync of a large board takes a couple of minutes. Later syncs take under a minute.
