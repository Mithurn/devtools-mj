import { Redis } from 'ioredis';
import { BATCH_SIZE, COMMAND_TIMEOUT_MS, LIST_STATES, QUEUE_CONCURRENCY, ZSET_STATES, type BoardConfig } from './config.js';
import { matches, type JobRecord } from './search.js';

const JOB_FIELDS = ['name', 'data', 'failedReason', 'timestamp', 'finishedOn'] as const;

const READ_ONLY_COMMANDS = new Set([
  'scan', 'zrange', 'lrange', 'hmget', 'zcard', 'llen', 'type', 'info', 'module',
  'auth', 'select', 'client', 'hello', 'ping', 'quit',
]);

export const connect = (board: BoardConfig): Redis => {
  const redis = new Redis(board.url, { commandTimeout: COMMAND_TIMEOUT_MS, maxRetriesPerRequest: 2 });
  const send = redis.sendCommand.bind(redis);
  redis.sendCommand = ((command: { name: string }, ...rest: unknown[]) => {
    if (!READ_ONLY_COMMANDS.has(command.name.toLowerCase())) {
      throw new Error(`bullsearch is read-only, blocked ${command.name}`);
    }
    return (send as (...a: unknown[]) => unknown)(command, ...rest);
  }) as typeof redis.sendCommand;
  return redis;
};

export const listQueues = async (redis: Redis, prefix: string): Promise<string[]> => {
  const names = new Set<string>();
  const suffix = ':meta';
  for await (const keys of redis.scanStream({ match: `${prefix}:*${suffix}`, count: 1000 })) {
    for (const key of keys as string[]) {
      names.add(key.slice(prefix.length + 1, key.length - suffix.length));
    }
  }
  return [...names].sort();
};

const run = async <T>(pipeline: ReturnType<Redis['pipeline']>): Promise<T[]> => {
  const results = await pipeline.exec();
  return (results ?? []).map(([err, value]) => {
    if (err) throw err;
    return value as T;
  });
};

export const jobIdsByState = async (
  redis: Redis,
  prefix: string,
  queue: string,
  states: readonly string[]
): Promise<Map<string, string[]>> => {
  const pipe = redis.pipeline();
  const order: string[] = [];
  for (const state of states) {
    const key = `${prefix}:${queue}:${state}`;
    if ((ZSET_STATES as readonly string[]).includes(state)) pipe.zrange(key, 0, -1);
    else if ((LIST_STATES as readonly string[]).includes(state)) pipe.lrange(key, 0, -1);
    else continue;
    order.push(state);
  }
  const lists = await run<string[]>(pipe);
  return new Map(order.map((state, i) => [state, lists[i]]));
};

export const countByState = async (redis: Redis, prefix: string, queue: string) => {
  const pipe = redis.pipeline();
  const states = [...ZSET_STATES, ...LIST_STATES];
  for (const state of states) {
    const key = `${prefix}:${queue}:${state}`;
    if ((ZSET_STATES as readonly string[]).includes(state)) pipe.zcard(key);
    else pipe.llen(key);
  }
  const counts = await run<number>(pipe);
  return Object.fromEntries(states.map((s, i) => [s, counts[i]]).filter(([, n]) => n));
};

const fetchJobs = async (
  redis: Redis,
  board: BoardConfig,
  prefix: string,
  queue: string,
  state: string,
  ids: string[]
): Promise<JobRecord[]> => {
  const pipe = redis.pipeline();
  for (const id of ids) pipe.hmget(`${prefix}:${queue}:${id}`, ...JOB_FIELDS);
  const rows = await run<(string | null)[]>(pipe);
  return rows.map((f, i) => ({
    board: board.name,
    uiUrl: board.uiUrl,
    queue,
    state,
    id: ids[i],
    name: f[0] ?? '',
    data: f[1] ?? '',
    failedReason: f[2] ?? '',
    timestamp: Number(f[3]) || 0,
    finishedOn: Number(f[4]) || 0,
  }));
};

export interface FindOptions {
  board: BoardConfig;
  terms: string[];
  queues: string[];
  states: readonly string[];
}

const searchQueue = async (redis: Redis, opts: FindOptions, queue: string): Promise<JobRecord[]> => {
  const { board } = opts;
  const hits: JobRecord[] = [];
  const byState = await jobIdsByState(redis, board.prefix, queue, opts.states);
  for (const [state, ids] of byState) {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const jobs = await fetchJobs(redis, board, board.prefix, queue, state, ids.slice(i, i + BATCH_SIZE));
      hits.push(...jobs.filter(j => matches(j, opts.terms)));
    }
  }
  return hits;
};

export const find = async (redis: Redis, opts: FindOptions): Promise<JobRecord[]> => {
  const pending = [...opts.queues];
  const hits: JobRecord[] = [];
  const worker = async () => {
    for (let queue = pending.shift(); queue; queue = pending.shift()) {
      hits.push(...(await searchQueue(redis, opts, queue)));
    }
  };
  await Promise.all(Array.from({ length: QUEUE_CONCURRENCY }, worker));
  return hits.sort((a, b) => a.timestamp - b.timestamp);
};
