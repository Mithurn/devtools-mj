import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { absenceTargets, itemCwd, problems, runItem } from './lib.mjs';

const CLI = new URL('./contract.mjs', import.meta.url).pathname;
const ws = mkdtempSync(join(tmpdir(), 'ct-'));
mkdirSync(join(ws, 'tasks', 'contracts'), { recursive: true });
writeFileSync(join(ws, 'a.ts'), 'const x = 1;\n');
const cli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CONTRACT_WS: ws } });

test('absence checks fail closed when the target is missing', () => {
  assert.equal(runItem(ws, { verify: '! grep -q 429 missing.ts' }), false);
  const item = { verify: '! grep -q 429 missing.ts' };
  runItem(ws, item);
  assert.match(item.evidence.output, /missing file/);
  assert.equal(runItem(ws, { verify: '! grep -q 429 a.ts' }), true);
  assert.equal(runItem(ws, { verify: '! grep -q const a.ts' }), false);
});

test('absence of a git ref fails closed', () => {
  spawnSync('git', ['init', '-q'], { cwd: ws });
  const item = { verify: '! git show origin/nope:a.ts | grep -q x' };
  assert.equal(runItem(ws, item), false);
  assert.match(item.evidence.output, /missing git object/);
});

test('absenceTargets finds files and refs', () => {
  assert.deepEqual(absenceTargets('! grep -q "a b" f1 f2'), [{ kind: 'file', path: 'f1' }, { kind: 'file', path: 'f2' }]);
});

test('contract cwd replaces the repo checkout for repo-level items', () => {
  const c = { cwd: 'repo-wt', repos: ['repo'] };
  assert.equal(itemCwd('/w', { cwd: 'repo' }, c), '/w/repo-wt');
  assert.equal(itemCwd('/w', { cwd: '.' }, c), '/w/repo-wt');
  assert.equal(itemCwd('/w', { cwd: 'other' }, c), '/w/other');
});

test('amend needs approval and applies only after approve-amendment', () => {
  writeFileSync(join(ws, 'tasks', 'contracts', 'T.json'), JSON.stringify({ ticket: 'T', status: 'approved', items: [{ id: 'i1', title: 't', verify: 'false', evidence: { ranAt: Date.now(), exit: 0 } }] }));
  writeFileSync(join(ws, 'tasks', 'contracts', 'ACTIVE'), 'T\n');
  assert.equal(cli('amend', 'i1', 'status constant renamed', '--verify', 'true').status, 0);
  const c = JSON.parse(spawnSync('cat', [join(ws, 'tasks', 'contracts', 'T.json')], { encoding: 'utf8' }).stdout);
  assert.equal(c.items[0].verify, 'false');
  assert.ok(problems(c).some(p => /amendment pending/.test(p)));
  assert.equal(cli('approve-amendment', 'i1').status, 0);
  assert.equal(cli('run').status, 0);
});
