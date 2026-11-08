#!/usr/bin/env node
import { activeTicket, load, problems, runItem, save, setActive, workspaceRoot } from './lib.mjs';

const USAGE = `usage: contract new <ticket> <title> | use <ticket> | show [ticket] | run [ticket] | confirm <item> <note> | approve [ticket] | status [ticket]
Contracts live in <workspace>/tasks/contracts/<ticket>.json. Items are {id, title, verify (shell command, exit 0 = done), cwd?} or {manual: true}.`;
const ws = workspaceRoot();
const [cmd, a, ...rest] = process.argv.slice(2);
const ticket = () => a && !['--'].includes(a) ? a : activeTicket(ws) ?? (() => { throw new Error('no active contract, pass a ticket id'); })();

const table = c => c.items.map(i => {
  const e = i.evidence;
  const mark = !e ? '[ ]' : e.exit === 0 ? '[x]' : '[!]';
  return `${mark} ${i.id}  ${i.title}${i.manual ? '  (manual)' : ''}`;
}).join('\n');

try {
  if (cmd === 'new') {
    save(ws, { ticket: a, title: rest.join(' '), status: 'draft', createdAt: Date.now(), scope: '', outOfScope: [], assumptions: [], openQuestions: [], items: [] });
    setActive(ws, a);
    console.log(`created draft contract ${a} and made it active. Fill in tasks/contracts/${a}.json`);
  } else if (cmd === 'use') {
    load(ws, a); setActive(ws, a); console.log(`active contract: ${a}`);
  } else if (cmd === 'show' || cmd === 'status') {
    const c = load(ws, ticket());
    console.log(`${c.ticket} ${c.title} [${c.status}]\n${table(c)}`);
    const p = problems(c);
    console.log(p.length ? `\nblocking (${p.length}):\n- ${p.join('\n- ')}` : '\nall items verified');
  } else if (cmd === 'run') {
    const c = load(ws, ticket());
    for (const i of c.items) if (i.verify && !i.manual) { const ok = runItem(ws, i); console.log(`${ok ? 'pass' : 'FAIL'} ${i.id}`); save(ws, c); }
    const p = problems(c);
    console.log(p.length ? `\nblocking (${p.length}):\n- ${p.join('\n- ')}` : '\nall items verified');
    process.exit(p.length ? 1 : 0);
  } else if (cmd === 'confirm') {
    const c = load(ws, activeTicket(ws) ?? '');
    const item = c.items.find(i => i.id === a);
    if (!item) throw new Error(`no item ${a}`);
    item.evidence = { ranAt: Date.now(), exit: 0, output: rest.join(' ') };
    save(ws, c); console.log(`confirmed ${a}`);
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
