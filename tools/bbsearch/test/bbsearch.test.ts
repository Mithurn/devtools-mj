import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardApi } from '../src/api.js';
import { resolveBoards } from '../src/config.js';
import { jobLink, parseTerms } from '../src/format.js';
import { openStore, searchJobs } from '../src/store.js';
import { syncBoard } from '../src/sync.js';

const NOW = Date.UTC(2026, 10, 9);

const fakeApi = (jobs: Record<string, { id: number; timestamp: number; finishedOn: number; data?: unknown; failedReason?: string }[]>): BoardApi => ({
  listQueues: async () => [{ name: 'q', counts: { failed: jobs.failed?.length ?? 0, completed: 0, active: jobs.active?.length ?? 0 } }],
  jobs: async (_q, state) => jobs[state] ?? [],
  job: async () => null,
});

test('sync indexes the full job data and search finds by any value', async () => {
  const db = openStore(':memory:');
  const api = fakeApi({
    failed: [{ id: 2, timestamp: NOW - 1000, finishedOn: NOW - 500, data: { mailbox: 'Jane@x.com', password: 'pw' }, failedReason: 'boom' }],
  });
  await syncBoard(db, 'clavis', api, { delayMs: 0, now: NOW });
  const { rows, total } = searchJobs(db, 'clavis', ['jane@x.com'], undefined, 10);
  assert.equal(total, 1);
  assert.equal(rows[0].failedReason, 'boom');
  assert.equal(searchJobs(db, 'clavis', ['pw'], undefined, 10).total, 1);
  assert.ok(rows[0].data.includes('"password":"pw"'));
});

test('re-sync stops at a page it already knows and picks up state changes', async () => {
  const db = openStore(':memory:');
  const job = { id: 1, timestamp: NOW - 1000, finishedOn: NOW - 500, failedReason: 'x' };
  await syncBoard(db, 'clavis', fakeApi({ failed: [job] }), { delayMs: 0, now: NOW });
  const again = await syncBoard(db, 'clavis', fakeApi({ failed: [job] }), { delayMs: 0, now: NOW });
  assert.equal(again.jobs, 0);
  await syncBoard(db, 'clavis', fakeApi({ active: [{ id: 1, timestamp: NOW - 1000, finishedOn: 0 }] }), { delayMs: 0, now: NOW });
  assert.equal(searchJobs(db, 'clavis', ['1'], ['active'], 10).total, 1);
});

test('like wildcards in terms are literal', () => {
  const db = openStore(':memory:');
  assert.equal(searchJobs(db, 'clavis', ['100%_'], undefined, 10).total, 0);
});

test('format helpers and board config', () => {
  assert.deepEqual(parseTerms('A@b.com, c'), ['a@b.com', 'c']);
  const [b] = resolveBoards('zapmail-be', { BBSEARCH_ZAPMAIL_BE_URL: 'https://h/api/v1/ui/', BBSEARCH_ZAPMAIL_BE_COOKIE: 'c=1' });
  assert.deepEqual(b, { name: 'zapmail-be', url: 'https://h/api/v1/ui', cookie: 'c=1' });
  assert.equal(jobLink(b.url, { board: 'b', queue: 'exports.accounts', id: '7', state: '', name: '', ts: 0, finished: 0, failedReason: '', data: '', haystack: '' }), 'https://h/api/v1/ui/queue/exports.accounts/7');
});
