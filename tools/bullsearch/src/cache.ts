import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Redis } from 'ioredis';
import { QUEUE_CACHE_FILE, QUEUE_CACHE_TTL_MS, type BoardConfig } from './config.js';
import { listQueues } from './scan.js';

type CacheFile = Record<string, { at: number; queues: string[] }>;

const read = (): CacheFile => {
  try {
    return JSON.parse(readFileSync(QUEUE_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
};

export const cachedQueues = async (redis: Redis, board: BoardConfig, refresh: boolean): Promise<string[]> => {
  const key = `${board.name}|${board.prefix}`;
  const cache = read();
  const hit = cache[key];
  if (!refresh && hit && Date.now() - hit.at < QUEUE_CACHE_TTL_MS) return hit.queues;
  const queues = await listQueues(redis, board.prefix);
  try {
    mkdirSync(dirname(QUEUE_CACHE_FILE), { recursive: true });
    writeFileSync(QUEUE_CACHE_FILE, JSON.stringify({ ...cache, [key]: { at: Date.now(), queues } }));
  } catch {}
  return queues;
};
