import type { DatabaseSync } from 'node:sqlite';
import type { ApiJob, BoardApi } from './api.js';
import { PAGED_STATES, PAGE_DELAY_MS, PAGE_SIZE, SMALL_STATES, SYNC_CONCURRENCY, SYNC_WINDOW_DAYS } from './config.js';
import { clearState, isKnown, markSynced, upsertJobs, type JobRow } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const toRow = (board: string, queue: string, state: string, j: ApiJob): JobRow => {
  const failedReason = j.failedReason ?? '';
  const data = typeof j.data === 'string' ? j.data : JSON.stringify(j.data ?? null);
  return {
    board,
    queue,
    id: String(j.id),
    state,
    name: j.name ?? '',
    ts: j.timestamp ?? 0,
    finished: j.finishedOn ?? 0,
    failedReason,
    data,
    haystack: `${j.id} ${data} ${failedReason}`.toLowerCase(),
  };
};

export interface SyncStats {
  requests: number;
  jobs: number;
}

export const syncBoard = async (
  db: DatabaseSync,
  board: string,
  api: BoardApi,
  opts: { delayMs?: number; now?: number } = {}
): Promise<SyncStats> => {
  const delay = opts.delayMs ?? PAGE_DELAY_MS;
  const cutoff = (opts.now ?? Date.now()) - SYNC_WINDOW_DAYS * DAY_MS;
  const stats: SyncStats = { requests: 1, jobs: 0 };
  const queues = await api.listQueues();

  const fetchPage = async (queue: string, state: string, page: number) => {
    stats.requests++;
    if (delay) await sleep(delay);
    return (await api.jobs(queue, state, page, PAGE_SIZE)).map(j => toRow(board, queue, state, j));
  };

  const syncQueue = async (q: (typeof queues)[number]) => {
    for (const state of SMALL_STATES) {
      if (!q.counts[state]) {
        clearState(db, board, q.name, state);
        continue;
      }
      const rows: JobRow[] = [];
      for (let page = 1; rows.length < q.counts[state]; page++) {
        const batch = await fetchPage(q.name, state, page);
        if (!batch.length) break;
        rows.push(...batch);
      }
      clearState(db, board, q.name, state);
      upsertJobs(db, rows);
      stats.jobs += rows.length;
    }
    for (const state of PAGED_STATES) {
      for (let page = 1; (q.counts[state] ?? 0) > (page - 1) * PAGE_SIZE; page++) {
        const batch = await fetchPage(q.name, state, page);
        if (!batch.length) break;
        const fresh = batch.filter(r => !isKnown(db, r));
        upsertJobs(db, fresh);
        stats.jobs += fresh.length;
        const oldest = Math.min(...batch.map(r => r.ts || Infinity));
        if (!fresh.length || oldest < cutoff) break;
      }
    }
  };

  const pending = [...queues];
  const worker = async () => {
    for (let q = pending.shift(); q; q = pending.shift()) await syncQueue(q);
  };
  await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, worker));
  markSynced(db, board);
  return stats;
};
