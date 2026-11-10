#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { activeTicket, load, problems, workspaceRoot } from '../tools/contract/lib.mjs';
import { evaluate } from './rules.mjs';

const READ_ONLY_SQL = /^\s*(select|with|explain|show)\b/i;
const STOP_MODE = process.argv.includes('--stop');
const TEAM_REMOTE = /dsouzaalan\//;
const CHECK_TAIL_LINES = 4;

const block = lines => {
  console.error(`Blocked by gate:\n- ${lines.join('\n- ')}`);
  process.exit(2);
};

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const effectiveCwd = (command, cwd) => {
  const m = /(?:^|[;&|(\n]\s*)cd\s+("([^"]+)"|'([^']+)'|(\S+))/.exec(command) ?? /\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/.exec(command);
  const target = m?.[2] ?? m?.[3] ?? m?.[4];
  if (!target) return cwd;
  return isAbsolute(target) ? target : resolve(cwd, target.replace(/^~/, homedir()));
};

const contractIssues = cwd => {
  const ws = workspaceRoot();
  const ticket = activeTicket(ws);
  if (!ticket) {
    console.error('gate: no active contract, scope not checked (tasks/contracts/ACTIVE)');
    return [];
  }
  try {
    const c = load(ws, ticket);
    const repo = String(cwd).startsWith(ws + '/') ? String(cwd).slice(ws.length + 1).split('/')[0] : '';
    if (c.repos?.length && repo && !c.repos.some(r => repo === r || repo.startsWith(`${r}-`))) return [];
    return problems(c).map(p => `contract ${ticket}: ${p}`);
  } catch (e) {
    return [`contract ${ticket}: ${e.message}`];
  }
};

const runCheck = (label, cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (r.status === 0 || r.error?.code === 'ENOENT') return [];
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-CHECK_TAIL_LINES).join(' | ');
  return [`${label} failed: ${tail}`];
};

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');

  if (STOP_MODE) {
    if (input.stop_hook_active) process.exit(0);
    const ws = workspaceRoot();
    const ticket = activeTicket(ws);
    if (!ticket) process.exit(0);
    const c = load(ws, ticket);
    const issues = contractIssues(input.cwd ?? ws);
    if (c.status === 'approved' && issues.length) block(['the approved contract is not complete, finish the items, or stop and ask the user (asking is allowed, ask once)', ...issues]);
    process.exit(0);
  }

  if (/^mcp__db-.*__execute_sql$/.test(input.tool_name ?? '')) {
    const sql = String(input.tool_input?.sql ?? '');
    const bad = sql.split(';').map(s => s.trim()).filter(Boolean).find(s => !READ_ONLY_SQL.test(s));
    if (bad) block([`database tools are read only, refused: ${bad.slice(0, 80)}`]);
    process.exit(0);
  }

  const command = input.tool_input?.command ?? '';
  const cwd = effectiveCwd(command, input.cwd ?? process.cwd());
  const ws = workspaceRoot();
  const issues = evaluate(command, {
    cwd,
    isTeamRepo: () => TEAM_REMOTE.test(git(cwd, 'remote', 'get-url', 'origin')),
    branch: () => git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
    prBase: cmd => {
      const arg = /gh\s+pr\s+merge\s+((?!-)\S+)/.exec(cmd)?.[1];
      try {
        return execFileSync('gh', ['pr', 'view', ...(arg ? [arg] : []), '--json', 'baseRefName', '--jq', '.baseRefName'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return undefined;
      }
    },
    prCommentCount: cmd => {
      const arg = /gh\s+pr\s+comment\s+((?!-)\S+)/.exec(cmd)?.[1];
      try {
        return Number(execFileSync('gh', ['pr', 'view', ...(arg ? [arg] : []), '--json', 'comments', '--jq', '.comments|length'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
      } catch {
        return 0;
      }
    },
    contractIssues: () => contractIssues(cwd),
    diffChecks: () => [
      ...runCheck('format check (run .claude/bin/fmt-changed)', join(ws, '.claude', 'bin', 'churn-check'), [cwd], cwd),
      ...runCheck('comment check (strip narrative comments)', join(homedir(), 'bin', 'comment-check'), [], cwd),
    ],
  });
  if (issues.length) block(issues);
} catch (e) {
  block([`gate crashed, failing closed: ${e.message}`]);
}
