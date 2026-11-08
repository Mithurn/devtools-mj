#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { activeTicket, load, problems, workspaceRoot } from '../tools/contract/lib.mjs';

const BANNED_IN_TEXT = [
  [/—/, 'em dash (use commas or separate sentences)'],
  [/co-authored-by:/i, 'Co-Authored-By trailer'],
  [/generated with \[?claude code/i, '"Generated with Claude Code" footer'],
  [/claude\.ai\/code\/session/i, 'Claude session link'],
  [/claude-session:/i, 'Claude-Session trailer'],
];
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([\w./-]+\))?!?: \S/;
const READ_ONLY_SQL = /^\s*(select|with|explain|show)\b/i;
const STOP_MODE = process.argv.includes('--stop');

const block = lines => {
  console.error(`Blocked by gate:\n- ${lines.join('\n- ')}`);
  process.exit(2);
};

const contractProblems = cwd => {
  const ws = workspaceRoot();
  const ticket = activeTicket(ws);
  if (!ticket) return { ticket: null, issues: [] };
  try {
    const c = load(ws, ticket);
    const repo = String(cwd ?? '').startsWith(ws + '/') ? String(cwd).slice(ws.length + 1).split('/')[0] : '';
    if (c.repos?.length && repo && !c.repos.includes(repo)) return { ticket: null, issues: [] };
    return { ticket, status: c.status, issues: problems(c).map(p => `contract ${ticket}: ${p}`) };
  } catch (e) {
    return { ticket, status: 'unknown', issues: [`contract ${ticket}: ${e.message}`] };
  }
};

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');

  if (STOP_MODE) {
    const { status, issues } = contractProblems(input.cwd);
    if (status === 'approved' && issues.length) block(['the approved contract is not complete, finish or ask before stopping', ...issues]);
    process.exit(0);
  }

  if (/^mcp__db-.*__execute_sql$/.test(input.tool_name ?? '')) {
    const sql = String(input.tool_input?.sql ?? '');
    const bad = sql.split(';').map(s => s.trim()).filter(Boolean).find(s => !READ_ONLY_SQL.test(s));
    if (bad) block([`database tools are read only, refused: ${bad.slice(0, 80)}`]);
    process.exit(0);
  }

  const command = input.tool_input?.command ?? '';
  const bare = command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' ');
  const isCommit = /(^|[;&|(\n]\s*)(?:\w+=\S+\s+)*git\s+(?:-C\s+\S+\s+)?commit\b/.test(bare);
  const isPrWrite = /(^|[;&|(\n]\s*)gh\s+pr\s+(create|edit)\b/.test(bare);
  const isPush = /(^|[;&|(\n]\s*)git\s+(?:-C\s+\S+\s+)?push\b/.test(bare);
  const isPrCreate = /(^|[;&|(\n]\s*)gh\s+pr\s+create\b/.test(bare);
  if (!isCommit && !isPrWrite && !isPush) process.exit(0);

  const issues = [];
  if (isCommit || isPrWrite) {
    for (const [re, why] of BANNED_IN_TEXT) if (re.test(command)) issues.push(`${isCommit ? 'commit message' : 'PR text'} contains ${why}`);
  }
  if (isPrCreate) {
    const m = /(?:--title|-t)\s+(?:"([^"]*)"|'([^']*)')/.exec(command);
    const title = m?.[1] ?? m?.[2];
    if (title && !CONVENTIONAL.test(title)) issues.push(`PR title is not conventional (type(scope): summary): ${title}`);
    if (/\n#{1,4} /.test(command)) issues.push('PR body has headers; use short bullets only');
  }
  if (isPush || isPrCreate) {
    const r = contractProblems(input.cwd);
    if (!r.ticket) console.error('gate: no active contract, scope not checked (tasks/contracts/ACTIVE)');
    issues.push(...r.issues);
  }
  if (issues.length) block(issues);
} catch (e) {
  block([`gate crashed, failing closed: ${e.message}`]);
}
