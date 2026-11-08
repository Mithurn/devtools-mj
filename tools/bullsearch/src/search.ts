export interface JobRecord {
  board: string;
  uiUrl: string;
  queue: string;
  state: string;
  id: string;
  name: string;
  data: string;
  failedReason: string;
  timestamp: number;
  finishedOn: number;
}

export const parseTerms = (raw: string): string[] =>
  raw.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

export const matches = (job: JobRecord, terms: string[]): boolean => {
  const haystack = `${job.id} ${job.data} ${job.failedReason}`.toLowerCase();
  return terms.some(t => haystack.includes(t));
};

export const scrub = (text: string, raw: boolean): string =>
  (raw ? text : text.replace(/[\w.+-]+@[\w.-]+/g, '<email>')).slice(0, 160) || '-';

export const jobLink = (job: JobRecord): string =>
  job.uiUrl ? `${job.uiUrl}/queue/${encodeURIComponent(job.queue)}/${encodeURIComponent(job.id)}` : '';

export const formatTime = (ms: number): string =>
  ms ? new Date(ms).toISOString().slice(5, 19).replace('T', ' ') : '-';

export const formatLine = (job: JobRecord, raw: boolean): string =>
  [
    job.board,
    job.queue,
    job.state,
    `id ${job.id}`,
    `created ${formatTime(job.timestamp)}`,
    `finished ${formatTime(job.finishedOn)}`,
    `| ${scrub(job.failedReason, raw)}`,
    jobLink(job),
  ].join(' ').trimEnd();

export const toJson = (job: JobRecord, raw: boolean) => ({
  board: job.board,
  link: jobLink(job) || null,
  queue: job.queue,
  state: job.state,
  id: job.id,
  name: job.name,
  createdAt: job.timestamp || null,
  finishedAt: job.finishedOn || null,
  failedReason: job.failedReason ? scrub(job.failedReason, raw) : null,
});
