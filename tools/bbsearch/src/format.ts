import type { JobRow } from './store.js';

export const parseTerms = (raw: string): string[] =>
  raw.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

const time = (ms: number) => (ms ? new Date(ms).toISOString().slice(5, 19).replace('T', ' ') : '-');

export const jobLink = (uiUrl: string, r: JobRow): string =>
  `${uiUrl}/queue/${encodeURIComponent(r.queue)}/${encodeURIComponent(r.id)}`;

export const formatLine = (uiUrl: string, r: JobRow, full: boolean): string => {
  const line = `${r.board} ${r.queue} ${r.state} id ${r.id} created ${time(r.ts)} finished ${time(r.finished)} | ${r.failedReason || '-'} ${jobLink(uiUrl, r)}`;
  return full ? `${line}\n  data ${r.data}` : line;
};

export const toJson = (uiUrl: string, r: JobRow) => ({
  board: r.board,
  queue: r.queue,
  state: r.state,
  id: r.id,
  link: jobLink(uiUrl, r),
  createdAt: r.ts || null,
  finishedAt: r.finished || null,
  failedReason: r.failedReason || null,
  data: r.data ? JSON.parse(r.data) : null,
});
