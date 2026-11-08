import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PREFIX = 'bull';
export const BATCH_SIZE = 500;
export const COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_LIMIT = 200;
export const QUEUE_CONCURRENCY = 8;
export const QUEUE_CACHE_TTL_MS = 60 * 60 * 1000;
export const QUEUE_CACHE_FILE = join(homedir(), '.cache', 'devtools-mj', 'bullsearch-queues.json');
export const DEFAULT_ENV_FILE = join(homedir(), '.config', 'devtools-mj', '.env');

export const ZSET_STATES = ['completed', 'failed', 'delayed', 'prioritized', 'waiting-children'] as const;
export const LIST_STATES = ['wait', 'active', 'paused'] as const;
export const STATES: readonly string[] = [...ZSET_STATES, ...LIST_STATES];

export interface BoardConfig {
  name: string;
  url: string;
  prefix: string;
  uiUrl: string;
}

type Env = Record<string, string | undefined>;

const envKey = (board: string, suffix: string) =>
  `BULLSEARCH_${board.toUpperCase().replace(/-/g, '_')}_${suffix}`;

export const loadEnvFile = (env: Env = process.env): void => {
  const file = env.BULLSEARCH_ENV_FILE ?? DEFAULT_ENV_FILE;
  if (existsSync(file)) process.loadEnvFile(file);
};

export const configuredBoards = (env: Env = process.env): string[] =>
  Object.keys(env)
    .map(k => /^BULLSEARCH_(.+)_REDIS_URL$/.exec(k)?.[1])
    .filter((n): n is string => !!n)
    .map(n => n.toLowerCase().replace(/_/g, '-'));

const boardFromEnv = (name: string, env: Env): BoardConfig => {
  const url = env[envKey(name, 'REDIS_URL')];
  if (!url) throw new Error(`${envKey(name, 'REDIS_URL')} is not set`);
  return {
    name,
    url,
    prefix: env[envKey(name, 'PREFIX')] ?? DEFAULT_PREFIX,
    uiUrl: (env[envKey(name, 'UI_URL')] ?? '').replace(/\/$/, ''),
  };
};

export const resolveBoards = (requested: string | undefined, env: Env = process.env): BoardConfig[] => {
  const configured = configuredBoards(env);
  const names = (requested ?? env.BULLSEARCH_BOARDS ?? configured.join(','))
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);
  if (!names.length) throw new Error('no boards configured, set BULLSEARCH_<BOARD>_REDIS_URL');
  return names.map(n => boardFromEnv(n, env));
};
