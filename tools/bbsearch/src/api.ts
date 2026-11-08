import { REQUEST_TIMEOUT_MS, type BoardConfig } from './config.js';

export interface ApiJob {
  id: string | number;
  name?: string;
  data?: unknown;
  timestamp?: number;
  finishedOn?: number;
  failedReason?: string;
}

export interface ApiQueue {
  name: string;
  counts: Record<string, number>;
}

export interface BoardApi {
  listQueues(): Promise<ApiQueue[]>;
  jobs(queue: string, state: string, page: number, perPage: number): Promise<ApiJob[]>;
  job(queue: string, id: string): Promise<unknown>;
}

export const httpApi = (board: BoardConfig): BoardApi => {
  const get = async (path: string) => {
    const res = await fetch(`${board.url}/api/${path}`, {
      headers: board.cookie ? { cookie: board.cookie } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`${board.name} ${res.status} for ${path.split('?')[0]}, check URL and cookie`);
    return res.json() as Promise<{ queues: (ApiQueue & { jobs: ApiJob[] })[] }>;
  };
  return {
    job: async (queue, id) => (await get(`queues/${encodeURIComponent(queue)}/${encodeURIComponent(id)}`)) as unknown,
    listQueues: async () => (await get('queues')).queues.map(q => ({ name: q.name, counts: q.counts })),
    jobs: async (queue, state, page, perPage) => {
      const q = `queues?activeQueue=${encodeURIComponent(queue)}&status=${state}&page=${page}&jobsPerPage=${perPage}`;
      return (await get(q)).queues.find(x => x.name === queue)?.jobs ?? [];
    },
  };
};
