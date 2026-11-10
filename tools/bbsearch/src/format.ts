import type { JobRow } from './store.js';

export const parseTerms = (raw: string, exact = false): string[] =>
  exact ? [raw.trim().toLowerCase()].filter(Boolean) : raw.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);

const SECRET_KEY = /pass(word)?|secret|token|api_?key|authorization|credential|private_?key|cookie/i;
const REDACTED = '[redacted]';

export const redact = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && typeof x === 'string' && x ? REDACTED : redact(x)]));
  return v;
};

export const redactText = (text: string): string => {
  try {
    return JSON.stringify(redact(JSON.parse(text)));
  } catch {
    return text.replace(/("?[\w-]*(?:pass(?:word)?|secret|token|api_?key|authorization)[\w-]*"?\s*[:=]\s*)"[^"]*"/gi, `$1"${REDACTED}"`);
  }
};

const time = (ms: number) => (ms ? new Date(ms).toISOString().slice(5, 19).replace('T', ' ') : '-');

export const jobLink = (uiUrl: string, r: JobRow): string =>
  `${uiUrl}/queue/${encodeURIComponent(r.queue)}/${encodeURIComponent(r.id)}`;

export const formatLine = (uiUrl: string, r: JobRow, full: boolean, raw = false): string => {
  const line = `${r.board} ${r.queue} ${r.state} id ${r.id} created ${time(r.ts)} finished ${time(r.finished)} | ${r.failedReason || '-'} ${jobLink(uiUrl, r)}`;
  return full ? `${line}\n  data ${raw ? r.data : redactText(r.data)}` : line;
};

export const toJson = (uiUrl: string, r: JobRow, raw = false) => ({
  board: r.board,
  queue: r.queue,
  state: r.state,
  id: r.id,
  link: jobLink(uiUrl, r),
  createdAt: r.ts || null,
  finishedAt: r.finished || null,
  failedReason: r.failedReason || null,
  data: r.data ? (raw ? JSON.parse(r.data) : redact(JSON.parse(r.data))) : null,
});
