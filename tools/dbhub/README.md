# dbhub

One MCP server for every database, read-only. Wraps [DBHub](https://github.com/bytebase/dbhub) with a committed config that holds no secrets.

- `dbhub.toml`: one `[[sources]]` per database (clavis-prod, zapmail-prod, zapmail-staging, clavis-local) and a `[[tools]]` pair per source. `execute_sql` is `readonly = true` with `max_rows = 1000` and a 30s query timeout. `search_objects` browses schemas and tables.
- `run.sh <source-id>`: loads `~/.config/devtools-mj/.env` (or `DBHUB_ENV_FILE`), keeps only that source from `dbhub.toml`, and starts DBHub pinned to 1.6.0 over stdio. One server per database, because DBHub exits if any configured source fails to connect.
- Passwords come only from env vars `DBHUB_<SOURCE>_PASSWORD` (`CLAVIS_PROD`, `ZAPMAIL_PROD`, `ZAPMAIL_STAGING`, `CLAVIS_LOCAL`). A source with an unset variable is rejected at load.

Register one MCP server per source: command `tools/dbhub/run.sh`, args `["clavis-prod"]` and so on. Prod hosts need Netbird.

Read-only is enforced twice: DBHub's `readonly` tool setting, and (recommended) a read-only database role. Schema changes and writes never go through this server.
