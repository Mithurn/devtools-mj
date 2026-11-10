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

const tokens = str => [...str.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);

export const absenceTargets = verify => {
  const out = [];
  for (const m of verify.matchAll(/(?:^|[;&|(]\s*)!\s+([^;&|\n]+)/g)) {
    const t = tokens(m[1]);
    if (t[0] === 'git' && t[1] === 'show' && t[2]) out.push({ kind: 'git', ref: t[2] });
    else if (t[0] === 'grep' || t[0] === 'rg') {
      const args = t.slice(1).filter(x => !x.startsWith('-'));
      for (const f of args.slice(1)) out.push({ kind: 'file', path: f });
    }
  }
  for (const m of verify.matchAll(/!\s+git\s+show\s+(\S+)/g)) if (!out.some(o => o.ref === m[1])) out.push({ kind: 'git', ref: m[1] });
  return out;
};

const missingTarget = (verify, cwd) => {
  for (const t of absenceTargets(verify)) {
    if (t.kind === 'file' && !existsSync(resolve(cwd, t.path))) return `absence check on a missing file: ${t.path}`;
    if (t.kind === 'git') {
      const r = spawnSync('git', ['-C', cwd, 'cat-file', '-e', t.ref], { encoding: 'utf8' });
      if (r.status !== 0) return `absence check on a missing git object (branch or file not found): ${t.ref}`;
    }
  }
  return '';
};

export const itemCwd = (ws, item, c = {}) => {
  const worktree = c.cwd && (!item.cwd || item.cwd === '.' || (c.repos ?? []).includes(item.cwd)) ? c.cwd : item.cwd;
  return worktree ? resolve(ws, worktree) : ws;
};

export const runItem = (ws, item, c = {}) => {
  const cwd = itemCwd(ws, item, c);
  const missing = missingTarget(item.verify, cwd);
  if (missing) {
    item.evidence = { ranAt: Date.now(), exit: 1, output: missing };
    return false;
  }
  const r = spawnSync('sh', ['-c', item.verify], { cwd, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  item.evidence = { ranAt: Date.now(), exit: r.status ?? -1, output: out.slice(-OUTPUT_TAIL_CHARS) };
  return item.evidence.exit === 0;
};

export const problems = (c, now = Date.now()) => {
  const out = [];
  if (c.status === 'draft') out.push('contract is still a draft, it needs human approval (contract approve)');
  for (const a of (c.amendments ?? []).filter(x => typeof x === 'object')) if (!a.approved) out.push(`amendment pending approval: ${a.item} (${a.reason})`);
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
