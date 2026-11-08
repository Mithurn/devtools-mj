import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const EVIDENCE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const VERIFY_TIMEOUT_MS = 180_000;
export const OUTPUT_TAIL_CHARS = 400;

export const workspaceRoot = () => {
  if (process.env.CONTRACT_WS) return process.env.CONTRACT_WS;
  let d = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  for (;;) {
    if (existsSync(join(d, 'tasks', 'contracts'))) return d;
    const up = resolve(d, '..');
    if (up === d) return resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    d = up;
  }
};
const dir = ws => join(ws, 'tasks', 'contracts');
const fileFor = (ws, ticket) => join(dir(ws), `${ticket}.json`);
const activeFile = ws => join(dir(ws), 'ACTIVE');

export const load = (ws, ticket) => {
  const f = fileFor(ws, ticket);
  if (!existsSync(f)) throw new Error(`no contract for ${ticket} at ${f}`);
  return JSON.parse(readFileSync(f, 'utf8'));
};
export const save = (ws, c) => {
  mkdirSync(dir(ws), { recursive: true });
  writeFileSync(fileFor(ws, c.ticket), JSON.stringify(c, null, 2) + '\n');
};
export const activeTicket = ws => (existsSync(activeFile(ws)) ? readFileSync(activeFile(ws), 'utf8').trim() || null : null);
export const setActive = (ws, ticket) => {
  mkdirSync(dir(ws), { recursive: true });
  writeFileSync(activeFile(ws), ticket + '\n');
};

export const runItem = (ws, item) => {
  const r = spawnSync('sh', ['-c', item.verify], { cwd: item.cwd ? resolve(ws, item.cwd) : ws, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  item.evidence = { ranAt: Date.now(), exit: r.status ?? -1, output: out.slice(-OUTPUT_TAIL_CHARS) };
  return item.evidence.exit === 0;
};

export const problems = (c, now = Date.now()) => {
  const out = [];
  if (c.status === 'draft') out.push('contract is still a draft, it needs human approval (contract approve)');
  for (const q of c.openQuestions ?? []) if (!q.answer) out.push(`open question: ${q.q}`);
  for (const i of c.items) {
    const e = i.evidence;
    if (!e) out.push(`not verified: ${i.id} ${i.title}`);
    else if (e.exit !== 0) out.push(`failing: ${i.id} ${i.title}`);
    else if (e.file && !existsSync(e.file)) out.push(`evidence file missing: ${i.id} ${e.file}`);
    else if (i.manual && !e.output && !e.file) out.push(`manual item needs a note or file: ${i.id}`);
    else if (now - e.ranAt > EVIDENCE_MAX_AGE_MS) out.push(`stale evidence (rerun): ${i.id} ${i.title}`);
  }
  return out;
};
