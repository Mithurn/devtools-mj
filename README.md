# devtools-mj

Small standalone CLIs for day-to-day engineering work. Each tool lives in `tools/<name>`, has its own `package.json`, takes config from env vars, and runs locally with the user's own access. No hosted services, no secrets in the repo.

| Tool | What it does |
| --- | --- |
| [`bullsearch`](tools/bullsearch) | Search BullMQ jobs by email, user ID, job ID or failed reason across every queue and state, straight from Redis |
