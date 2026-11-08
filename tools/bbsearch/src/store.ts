import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface JobRow {
  board: string;
  queue: string;
  id: string;
  state: string;
  name: string;
  ts: number;
  finished: number;
  failedReason: string;
  data: string;
  haystack: string;
}

export const openStore = (file: string): DatabaseSync => {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      board TEXT NOT NULL, queue TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL,
      name TEXT, ts INTEGER, finished INTEGER, failed_reason TEXT, data TEXT, haystack TEXT,
      PRIMARY KEY (board, queue, id)
    );
    CREATE INDEX IF NOT EXISTS jobs_state ON jobs (board, queue, state, ts);
    CREATE TABLE IF NOT EXISTS meta (board TEXT PRIMARY KEY, synced_at INTEGER);
  `);
  if (file !== ':memory:') chmodSync(file, 0o600);
  return db;
};

export const upsertJobs = (db: DatabaseSync, rows: JobRow[]): void => {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO jobs (board, queue, id, state, name, ts, finished, failed_reason, data, haystack)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN');
  try {
    for (const r of rows) stmt.run(r.board, r.queue, r.id, r.state, r.name, r.ts, r.finished, r.failedReason, r.data, r.haystack);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const clearState = (db: DatabaseSync, board: string, queue: string, state: string): void => {
  db.prepare('DELETE FROM jobs WHERE board = ? AND queue = ? AND state = ?').run(board, queue, state);
};

export const isKnown = (db: DatabaseSync, r: JobRow): boolean =>
  !!db
    .prepare('SELECT 1 FROM jobs WHERE board = ? AND queue = ? AND id = ? AND state = ? AND finished = ?')
    .get(r.board, r.queue, r.id, r.state, r.finished);

const likeEscape = (t: string) => t.replace(/[\\%_]/g, c => `\\${c}`);

export const searchJobs = (
  db: DatabaseSync,
  board: string,
  terms: string[],
  states: string[] | undefined,
  limit: number
): { rows: JobRow[]; total: number } => {
  const where = ['board = ?', `(${terms.map(() => "haystack LIKE ? ESCAPE '\\'").join(' OR ')})`];
  const params: (string | number)[] = [board, ...terms.map(t => `%${likeEscape(t)}%`)];
  if (states?.length) {
    where.push(`state IN (${states.map(() => '?').join(',')})`);
    params.push(...states);
  }
  const clause = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${clause}`).get(...params) as { n: number }).n;
  const raw = db
    .prepare(`SELECT * FROM jobs WHERE ${clause} ORDER BY ts DESC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];
  const rows = raw.map(r => ({
    board: r.board as string,
    queue: r.queue as string,
    id: r.id as string,
    state: r.state as string,
    name: (r.name as string) ?? '',
    ts: Number(r.ts),
    finished: Number(r.finished),
    failedReason: (r.failed_reason as string) ?? '',
    data: (r.data as string) ?? '',
    haystack: '',
  }));
  return { rows, total };
};

export const markSynced = (db: DatabaseSync, board: string): void => {
  db.prepare('INSERT OR REPLACE INTO meta (board, synced_at) VALUES (?, ?)').run(board, Date.now());
};

export const syncedAt = (db: DatabaseSync, board: string): number | undefined =>
  (db.prepare('SELECT synced_at FROM meta WHERE board = ?').get(board) as { synced_at: number } | undefined)?.synced_at;

export const countJobs = (db: DatabaseSync, board: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE board = ?').get(board) as { n: number }).n;
