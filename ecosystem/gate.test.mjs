import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const GATE = new URL('./gate.mjs', import.meta.url).pathname;
const ws = mkdtempSync(join(tmpdir(), 'gate-'));
mkdirSync(join(ws, 'tasks', 'contracts'), { recursive: true });

const run = (input, args = [], env = {}) =>
  spawnSync('node', [GATE, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CONTRACT_WS: ws, ...env } });
const bash = command => run({ tool_name: 'Bash', cwd: ws, tool_input: { command } });
const setContract = c => {
  writeFileSync(join(ws, 'tasks', 'contracts', 'T1.json'), JSON.stringify(c));
  writeFileSync(join(ws, 'tasks', 'contracts', 'ACTIVE'), 'T1\n');
};
const fresh = { exit: 0, ranAt: Date.now(), output: '' };

test('commit text rules', () => {
  assert.equal(bash('git commit -m "fix(x): add y"').status, 0);
  assert.equal(bash('git commit -m "fix: a — b"').status, 2);
  assert.equal(bash('git commit -m "x\n\nCo-Authored-By: Claude <n@a.com>"').status, 2);
});

test('commands mentioned inside heredocs or quotes are not git commands', () => {
  assert.equal(bash("cat > README.md <<'EOF'\n# title\nblocks git push and gh pr create\nEOF").status, 0);
  assert.equal(bash('echo "run git push later"').status, 0);
});

test('commit and push after cd are still detected', () => {
  assert.equal(bash('cd repo && git commit -m "x — y"').status, 2);
  assert.equal(bash('git -C repo commit -m "x — y"').status, 2);
});

test('PR title and body rules', () => {
  assert.equal(bash('gh pr create --title "Add stuff" --body "- a"').status, 2);
  assert.equal(bash('gh pr create --title "fix(clavis): list workspaces" --body "- a"').status, 0);
  assert.equal(bash('gh pr create --title "fix(a): b" --body "$(cat <<EOF\n- a\nGenerated with [Claude Code](https://claude.com/claude-code)\nEOF\n)"').status, 2);
});

test('database tools are read only', () => {
  const sql = s => run({ tool_name: 'mcp__db-clavis-prod__execute_sql', tool_input: { sql: s } }).status;
  assert.equal(sql('select 1; with a as (select 2) select * from a'), 0);
  assert.equal(sql('select 1; delete from x'), 2);
});

test('draft, failing and stale contracts block push, verified one passes', () => {
  const items = ok => [{ id: 'a', title: 'a', verify: 'true', evidence: ok }];
  setContract({ ticket: 'T1', status: 'draft', items: items(fresh) });
  assert.equal(bash('git push').status, 2);
  setContract({ ticket: 'T1', status: 'approved', items: items({ ...fresh, exit: 1 }) });
  assert.equal(bash('git push').status, 2);
  setContract({ ticket: 'T1', status: 'approved', items: items({ ...fresh, ranAt: Date.now() - 5 * 3600 * 1000 }) });
  assert.equal(bash('git push').status, 2);
  setContract({ ticket: 'T1', status: 'approved', items: items(fresh) });
  assert.equal(bash('git push').status, 0);
});

test('contract only applies to its repos', () => {
  setContract({ ticket: 'T1', status: 'draft', repos: ['clavis'], items: [] });
  mkdirSync(join(ws, 'other'), { recursive: true });
  assert.equal(run({ tool_name: 'Bash', cwd: join(ws, 'other'), tool_input: { command: 'git push' } }).status, 0);
  mkdirSync(join(ws, 'clavis'), { recursive: true });
  assert.equal(run({ tool_name: 'Bash', cwd: join(ws, 'clavis'), tool_input: { command: 'git push' } }).status, 2);
  mkdirSync(join(ws, 'clavis-list-workspaces'), { recursive: true });
  assert.equal(run({ tool_name: 'Bash', cwd: join(ws, 'clavis-list-workspaces'), tool_input: { command: 'git push' } }).status, 2);
  mkdirSync(join(ws, 'clavisx'), { recursive: true });
  assert.equal(run({ tool_name: 'Bash', cwd: join(ws, 'clavisx'), tool_input: { command: 'git push' } }).status, 0);
});

test('stop hook only blocks an approved incomplete contract', () => {
  setContract({ ticket: 'T1', status: 'draft', items: [{ id: 'a', title: 'a', verify: 'true' }] });
  assert.equal(run({}, ['--stop']).status, 0);
  setContract({ ticket: 'T1', status: 'approved', items: [{ id: 'a', title: 'a', verify: 'true' }] });
  assert.equal(run({}, ['--stop']).status, 2);
});

test('large unbounded reads are blocked, slices and small files pass', () => {
  const big = join(ws, 'big.txt');
  writeFileSync(big, 'x'.repeat(150_000));
  const read = input => run({ tool_name: 'Read', cwd: ws, tool_input: input });
  assert.equal(read({ file_path: big }).status, 2);
  assert.equal(read({ file_path: big, limit: 50 }).status, 0);
  writeFileSync(join(ws, 'small.txt'), 'x');
  assert.equal(read({ file_path: join(ws, 'small.txt') }).status, 0);
});
