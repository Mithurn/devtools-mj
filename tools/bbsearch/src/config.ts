import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DB_FILE = join(homedir(), '.cache', 'devtools-mj', 'bbsearch.db');
export const DEFAULT_ENV_FILE = join(homedir(), '.config', 'devtools-mj', '.env');
export const PAGE_SIZE = 500;
export const PAGE_DELAY_MS = 150;
export const SYNC_CONCURRENCY = 3;
export const REQUEST_TIMEOUT_MS = 60_000;
export const SYNC_WINDOW_DAYS = 3;
export const DEFAULT_LIMIT = 200;
export const STALE_WARN_MS = 15 * 60 * 1000;
export const PAGED_STATES = ['completed', 'failed'] as const;
export const SMALL_STATES = ['active', 'waiting', 'delayed', 'paused', 'prioritized', 'waiting-children'] as const;

export interface BoardConfig {
  name: string;
  url: string;
  cookie: string;
}

type Env = Record<string, string | undefined>;

const envKey = (board: string, suffix: string) =>
  `BBSEARCH_${board.toUpperCase().replace(/-/g, '_')}_${suffix}`;

export const loadEnvFile = (env: Env = process.env): void => {
  const file = env.BBSEARCH_ENV_FILE ?? DEFAULT_ENV_FILE;
  if (existsSync(file)) process.loadEnvFile(file);
};

export const configuredBoards = (env: Env = process.env): string[] =>
  Object.keys(env)
    .map(k => /^BBSEARCH_(.+)_URL$/.exec(k)?.[1])
    .filter((n): n is string => !!n)
    .map(n => n.toLowerCase().replace(/_/g, '-'));

export const resolveBoards = (requested: string | undefined, env: Env = process.env): BoardConfig[] => {
  const names = (requested ?? env.BBSEARCH_BOARDS ?? configuredBoards(env).join(','))
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);
  if (!names.length) throw new Error('no boards configured, set BBSEARCH_<BOARD>_URL');
  return names.map(name => {
    const url = env[envKey(name, 'URL')];
    if (!url) throw new Error(`${envKey(name, 'URL')} is not set`);
    return { name, url: url.replace(/\/$/, ''), cookie: env[envKey(name, 'COOKIE')] ?? '' };
  });
};
