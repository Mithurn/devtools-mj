#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { DEFAULT_LIMIT, STATES, loadEnvFile, resolveBoards, type BoardConfig } from './config.js';
import { cachedQueues } from './cache.js';
import { connect, countByState, find } from './scan.js';
import { formatLine, parseTerms, toJson } from './search.js';

const USAGE = `usage: bullsearch doctor | queues | find <term[,term]|-> [queue ...]
  --board a,b,c (order = search order)  --all (keep going after first board with hits)
  --state failed,completed  --limit <n>  --json  --raw  --refresh (rescan queue list)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    board: { type: 'string' },
    all: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    state: { type: 'string' },
    limit: { type: 'string' },
    json: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
  },
});

const doctor = async (board: BoardConfig) => {
  const redis = connect(board);
  try {
    const info = await redis.info('server');
    const modules = await redis.call('MODULE', 'LIST').catch(() => null);
    const names = Array.isArray(modules) ? modules.map(m => (m as unknown[])[1]) : null;
    const queues = await cachedQueues(redis, board, true);
    const type = queues.length ? await redis.type(`${board.prefix}:${queues[0]}:failed`) : 'n/a';
    console.log(
      `${board.name} ok redis ${/redis_version:(\S+)/.exec(info)?.[1] ?? '?'} modules ${names ? names.join(',') || 'none' : 'unknown'} ` +
        `queues ${queues.length} prefix "${board.prefix}" layout ${type} ui ${board.uiUrl || 'unset'}`
    );
  } finally {
    redis.disconnect();
  }
};

const queuesOf = async (board: BoardConfig) => {
  const redis = connect(board);
  try {
    for (const queue of await cachedQueues(redis, board, values.refresh)) {
      console.log(board.name, queue, JSON.stringify(await countByState(redis, board.prefix, queue)));
    }
  } finally {
    redis.disconnect();
  }
};

const findOn = async (board: BoardConfig, terms: string[], explicitQueues: string[]) => {
  const redis = connect(board);
  try {
    const queues = explicitQueues.length ? explicitQueues : await cachedQueues(redis, board, values.refresh);
    const states = values.state ? values.state.split(',') : STATES;
    return { hits: await find(redis, { board, terms, queues, states }), queueCount: queues.length };
  } finally {
    redis.disconnect();
  }
};

const main = async () => {
  const [cmd, ...rest] = positionals;
  if (!cmd) throw new Error(USAGE);
  loadEnvFile();
  const boards = resolveBoards(values.board);

  if (cmd === 'doctor' || cmd === 'queues') {
    for (const board of boards) {
      await (cmd === 'doctor' ? doctor(board) : queuesOf(board)).catch(err =>
        console.error(`${board.name} FAILED ${err instanceof Error ? err.message : err}`)
      );
    }
    return;
  }
  if (cmd !== 'find' || !rest[0]) throw new Error(USAGE);

  const terms = parseTerms(rest[0] === '-' ? readFileSync(0, 'utf8') : rest[0]);
  const limit = Number(values.limit ?? DEFAULT_LIMIT);
  let total = 0;
  for (const board of boards) {
    const started = Date.now();
    try {
      const { hits, queueCount } = await findOn(board, terms, rest.slice(1));
      for (const job of hits.slice(0, limit)) {
        console.log(values.json ? JSON.stringify(toJson(job, values.raw)) : formatLine(job, values.raw));
      }
      console.error(`--- ${board.name}: ${hits.length} jobs in ${queueCount} queues, ${Date.now() - started}ms`);
      total += hits.length;
      if (hits.length && !values.all) return;
    } catch (err) {
      console.error(`--- ${board.name}: FAILED ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!total) console.error(`--- no match on ${boards.map(b => b.name).join(', ')}`);
};

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
