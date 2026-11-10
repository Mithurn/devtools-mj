#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
process.removeAllListeners('warning');
const { DB_FILE, DEFAULT_LIMIT, STALE_WARN_MS, loadEnvFile, resolveBoards } = await import('./config.js');
const { httpApi } = await import('./api.js');
const { countJobs, openStore, searchJobs, syncedAt } = await import('./store.js');
const { syncBoard } = await import('./sync.js');
const { formatLine, parseTerms, redact, toJson } = await import('./format.js');
const { setCookie } = await import('./cookie.js');

const USAGE = `usage: bbsearch sync | status | cookie <board> | find <term[,term]|-> | job <queue> <id>
  --board a,b,c (order = search order)  --all (keep going after the first board with hits)
  --state failed,completed  --limit <n>  --json  --full (print job data)  --sync (sync before searching)
  --exact (treat the whole term as one phrase, no splitting)  --raw (do not redact passwords, keys and tokens in job data)
  job ids: use the id printed by find (for exports, the export id); platform:<id> does not work`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    board: { type: 'string' },
    all: { type: 'boolean', default: false },
    state: { type: 'string' },
    limit: { type: 'string' },
    json: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    sync: { type: 'boolean', default: false },
    exact: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
  },
});

const age = (ms: number) => `${Math.round((Date.now() - ms) / 60000)}m`;

const main = async () => {
  const [cmd, term] = positionals;
  if (!cmd) throw new Error(USAGE);
  loadEnvFile();
  if (cmd === 'cookie') {
    if (!term) throw new Error('usage: bbsearch cookie <board>  (copy the bull_board_token from the board page first)');
    console.log(setCookie(term));
    return;
  }
  const boards = resolveBoards(values.board);
  const db = openStore(DB_FILE);

  const sync = async (board: (typeof boards)[number]) => {
    const started = Date.now();
    const s = await syncBoard(db, board.name, httpApi(board));
    console.error(`--- synced ${board.name}: ${s.jobs} new jobs, ${s.requests} requests, ${Date.now() - started}ms`);
  };

  if (cmd === 'sync') {
    await Promise.all(
      boards.map(b => sync(b).catch(e => console.error(`--- ${b.name} FAILED ${e instanceof Error ? e.message : e}`)))
    );
    return;
  }
  if (cmd === 'status') {
    for (const b of boards) {
      const at = syncedAt(db, b.name);
      console.log(b.name, at ? `synced ${age(at)} ago` : 'never synced', `${countJobs(db, b.name)} jobs`);
    }
    return;
  }
  if (cmd === 'job') {
    const [, queue, id] = positionals;
    if (!queue || !id) throw new Error(USAGE);
    const job = await httpApi(boards[0]).job(queue, id);
    console.log(JSON.stringify(values.raw ? job : redact(job), null, 2));
    return;
  }
  if (cmd !== 'find' || !term) throw new Error(USAGE);

  const terms = parseTerms(term === '-' ? readFileSync(0, 'utf8') : term, values.exact);
  const limit = Number(values.limit ?? DEFAULT_LIMIT);
  const states = values.state?.split(',');
  let total = 0;
  for (const board of boards) {
    const at = syncedAt(db, board.name);
    if ((!at && !countJobs(db, board.name)) || values.sync) {
      try {
        await sync(board);
      } catch (e) {
        console.error(`--- ${board.name} FAILED ${e instanceof Error ? e.message : e}`);
        continue;
      }
    } else if (!at || Date.now() - at > STALE_WARN_MS) {
      console.error(`--- ${board.name} index is ${at ? `${age(at)} old` : 'incomplete'}, add --sync to refresh`);
    }
    const started = Date.now();
    const { rows, total: n } = searchJobs(db, board.name, terms, states, limit);
    for (const r of rows) console.log(values.json ? JSON.stringify(toJson(board.url, r, values.raw)) : formatLine(board.url, r, values.full, values.raw));
    console.error(`--- ${board.name}: ${n} jobs${n > limit ? `, showing ${limit}` : ''}, ${Date.now() - started}ms`);
    total += n;
    if (n && !values.all) return;
  }
  if (!total) console.error(`--- no match on ${boards.map(b => b.name).join(', ')}`);
};

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
