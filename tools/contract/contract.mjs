#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { activeTicket, load, problems, runItem, save, setActive, workspaceRoot } from './lib.mjs';

const USAGE = `usage: contract new <ticket> <title> [--no-activate] | use <ticket> | show [ticket] | run [ticket] | confirm <item> <note> [--file path] | approve [ticket] | amend <item> <reason> [--verify <cmd>] [--title <t>] | approve-amendment <item> | cwd <path> | status [ticket]
Contracts live in <workspace>/tasks/contracts/<ticket>.json. Items are {id, title, verify (shell command, exit 0 = done), cwd?} or {manual: true}.`;
const ws = workspaceRoot();
const [cmd, a, ...rest] = process.argv.slice(2);
const ticket = () => a && !['--'].includes(a) ? a : activeTicket(ws) ?? (() => { throw new Error('no active contract, pass a ticket id'); })();

const worktreeFor = c => {
  const found = [];
  for (const repo of c.repos ?? []) {
    try {
      const out = execFileSync('git', ['-C', resolve(ws, repo), 'worktree', 'list', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const block of out.split('\n\n')) {
        const path = /^worktree (.+)$/m.exec(block)?.[1];
        const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '';
        if (path && resolve(path) !== resolve(ws, repo) && branch.startsWith('mithurn/')) found.push(path.startsWith(ws + '/') ? path.slice(ws.length + 1) : path);
      }
    } catch {}
  }
  return found.length === 1 ? found[0] : '';
};

const table = c => c.items.map(i => {
  const e = i.evidence;
  const mark = !e ? '[ ]' : e.exit === 0 ? '[x]' : '[!]';
  return `${mark} ${i.id}  ${i.title}${i.manual ? '  (manual)' : ''}`;
}).join('\n');

try {
  if (cmd === 'new') {
    const noActivate = rest.includes('--no-activate');
    save(ws, { ticket: a, title: rest.filter(x => x !== '--no-activate').join(' '), status: 'draft', createdAt: Date.now(), scope: '', outOfScope: [], assumptions: [], openQuestions: [], items: [] });
    if (!noActivate) setActive(ws, a);
    console.log(`created draft contract ${a}${noActivate ? '' : ' and made it active'}. Fill in tasks/contracts/${a}.json`);
  } else if (cmd === 'use') {
    const c = load(ws, a); setActive(ws, a); console.log(`active contract: ${a}`);
    const wt = c.cwd ?? worktreeFor(c);
    if (wt && !c.cwd) { c.cwd = wt; save(ws, c); }
    console.log(wt ? `verify cwd: ${wt}` : 'verify cwd: not set (no single ticket worktree found), set it with: contract cwd <worktree path>');
  } else if (cmd === 'show' || cmd === 'status') {
    const c = load(ws, ticket());
    console.log(`${c.ticket} ${c.title} [${c.status}]\n${table(c)}`);
    const p = problems(c);
    console.log(p.length ? `\nblocking (${p.length}):\n- ${p.join('\n- ')}` : '\nall items verified');
  } else if (cmd === 'run') {
    const c = load(ws, ticket());
    for (const i of c.items) if (i.verify && !i.manual) { const ok = runItem(ws, i, c); console.log(`${ok ? 'pass' : 'FAIL'} ${i.id}`); save(ws, c); }
    const p = problems(c);
    console.log(p.length ? `\nblocking (${p.length}):\n- ${p.join('\n- ')}` : '\nall items verified');
    process.exit(p.length ? 1 : 0);
  } else if (cmd === 'confirm') {
    const c = load(ws, activeTicket(ws) ?? '');
    const item = c.items.find(i => i.id === a);
    if (!item) throw new Error(`no item ${a}`);
    const fi = rest.indexOf('--file');
    const file = fi === -1 ? undefined : resolve(rest[fi + 1] ?? '');
    if (file && !existsSync(file)) throw new Error(`evidence file not found: ${file}`);
    const note = rest.filter((_, i) => fi === -1 || (i !== fi && i !== fi + 1)).join(' ');
    if (!note && !file) throw new Error('give a note and/or --file <path>');
    item.evidence = { ranAt: Date.now(), exit: 0, output: note, ...(file ? { file, bytes: statSync(file).size } : {}) };
    save(ws, c); console.log(`confirmed ${a}${file ? ` with ${file}` : ''}`);
  } else if (cmd === 'cwd') {
    const c = load(ws, activeTicket(ws) ?? '');
    if (!a || !existsSync(resolve(ws, a))) throw new Error(`worktree path not found: ${a}`);
    c.cwd = a; save(ws, c); console.log(`verify cwd for ${c.ticket}: ${a}`);
  } else if (cmd === 'amend') {
    const c = load(ws, activeTicket(ws) ?? '');
    const item = c.items.find(i => i.id === a);
    if (!item) throw new Error(`no item ${a}`);
    const vi = rest.indexOf('--verify'), ti = rest.indexOf('--title');
    const skip = new Set([vi !== -1 && vi, vi !== -1 && vi + 1, ti !== -1 && ti, ti !== -1 && ti + 1]);
    const reason = rest.filter((_, i) => !skip.has(i)).join(' ');
    if (!reason) throw new Error('give a reason: contract amend <item> "<reason>" [--verify "<cmd>"] [--title "<t>"]');
    if (vi === -1 && ti === -1) throw new Error('nothing to amend, pass --verify and/or --title');
    const change = { item: a, reason, at: Date.now(), approved: false, from: { title: item.title, verify: item.verify } };
    if (vi !== -1) change.verify = rest[vi + 1];
    if (ti !== -1) change.title = rest[ti + 1];
    (c.amendments ??= []).push(change);
    save(ws, c);
    console.log(`amendment logged for ${a}, pending the user's approval: contract approve-amendment ${a}`);
  } else if (cmd === 'approve-amendment') {
    const c = load(ws, activeTicket(ws) ?? '');
    const pend = (c.amendments ?? []).filter(x => typeof x === 'object' && x.item === a && !x.approved);
    if (!pend.length) throw new Error(`no pending amendment for ${a}`);
    const item = c.items.find(i => i.id === a);
    for (const x of pend) {
      if (x.verify) item.verify = x.verify;
      if (x.title) item.title = x.title;
      x.approved = true; x.approvedAt = Date.now();
    }
    delete item.evidence; save(ws, c);
    console.log(`amendment applied to ${a}, rerun: contract run`);
  } else if (cmd === 'approve') {
    const c = load(ws, ticket());
    const open = (c.openQuestions ?? []).filter(q => !q.answer);
    if (open.length) throw new Error(`answer the open questions first:\n- ${open.map(q => q.q).join('\n- ')}`);
    if (!c.items.length) throw new Error('contract has no items');
    c.status = 'approved'; c.approvedAt = Date.now(); save(ws, c);
    console.log(`approved ${c.ticket}: ${c.items.length} items`);
  } else {
    console.error(USAGE); process.exit(1);
  }
} catch (e) {
  console.error(e.message); process.exit(1);
}
