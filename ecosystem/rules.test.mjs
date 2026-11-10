import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from './rules.mjs';

const ctx = (over = {}) => ({
  cwd: '/ws/clavis',
  isTeamRepo: () => true,
  branch: () => 'mithurn/list-workspaces',
  prBase: () => 'staging',
  prCommentCount: () => 0,
  contractIssues: () => [],
  diffChecks: () => [],
  ...over,
});
const bad = (cmd, c, re) => assert.ok(evaluate(cmd, ctx(c)).some(i => re.test(i)), `${cmd} should be blocked by ${re}`);
const ok = (cmd, c) => assert.deepEqual(evaluate(cmd, ctx(c)), [], cmd);

test('normal push from a feature branch passes', () => {
  ok('git push -u origin mithurn/list-workspaces');
  ok('git push --force-with-lease origin mithurn/list-workspaces');
});

test('protected targets, force and bad branch names are blocked on team repos', () => {
  bad('git push origin main', {}, /direct pushes/);
  bad('git push origin HEAD:staging', {}, /direct pushes/);
  bad('git push --force origin mithurn/x', {}, /force push/);
  bad('git push', { branch: () => 'main' }, /direct pushes are blocked/);
  bad('git push', { branch: () => 'fix/random-thing' }, /should be mithurn/);
  bad('git push', { branch: () => 'mithurn/14ze67xe7eg-lists' }, /ClickUp ID/);
  bad('git push', { branch: () => 'mithurn/CU-86d4bapj0' }, /ClickUp ID/);
});

test('personal repos skip team branch rules but still block force push', () => {
  ok('git push origin main', { isTeamRepo: () => false });
  bad('git push -f origin main', { isTeamRepo: () => false }, /force push/);
});

test('another statement mentioning main does not trip the push rule', () => {
  ok('git push origin mithurn/x && echo main');
});

test('merge only into staging, never admin', () => {
  ok('gh pr merge 12 --squash', { prBase: () => 'staging' });
  bad('gh pr merge 12', { prBase: () => 'main' }, /only PRs into staging/);
  bad('gh pr merge 12', { prBase: () => undefined }, /only PRs into staging/);
  bad('gh pr merge 12 --admin', {}, /--admin/);
});

test('deploys, workflows, migrations and publishing are blocked', () => {
  bad('gh workflow run deploy.yml', {}, /workflows/);
  bad('npx trigger.dev deploy', {}, /--env staging/);
  ok('npx trigger.dev deploy --env staging');
  bad('npx trigger.dev@latest deploy --env prod', {}, /production deploy|--env staging/);
  bad('npx prisma migrate deploy', {}, /migration/);
  bad('npx ts-node scripts/sync-db.ts', {}, /sync-db/);
  bad('npm publish', {}, /publishing/);
  bad('vercel --prod', {}, /production deploy/);
});

test('growth-os keeps its prisma exception', () => {
  ok('npx prisma migrate deploy', { cwd: '/home/u/Developer/active/xeno-grow' });
  bad('gh workflow run x.yml', { cwd: '/home/u/Developer/active/xeno-grow' }, /workflows/);
});

test('psql writes only against local databases', () => {
  bad('psql "postgres://u@host/db" -c "delete from t"', {}, /psql write/);
  ok('psql "postgres://u@localhost/db" -c "delete from t"');
  ok('psql "postgres://u@host/db" -c "select 1"');
});

test('commit runs the diff checks on team repos only', () => {
  const failing = { diffChecks: () => ['format check failed: x'] };
  bad('git commit -m "fix(a): b"', failing, /format check/);
  ok('git commit -m "fix(a): b"', { ...failing, isTeamRepo: () => false });
});

test('text lint and contract issues still apply', () => {
  bad('git commit -m "a — b"', {}, /em dash/);
  bad('git push origin mithurn/x', { contractIssues: () => ['contract T1: not verified: a'] }, /contract T1/);
  bad('gh pr merge 3', { prBase: () => 'staging', contractIssues: () => ['contract T1: draft'] }, /contract T1/);
});

test('words inside heredocs and quotes do not count as commands', () => {
  ok("cat > x.md <<'EOF'\ngh workflow run\nnpm publish\nEOF");
  ok('echo "git push origin main"');
});

test('PR comments: one at most, same text rules', () => {
  ok('gh pr comment 5 --body "- fixed the limit"');
  bad('gh pr comment 5 --body "- more"', { prCommentCount: () => 1 }, /at most one comment/);
  bad('gh pr comment 5 --body "- tested with a mock server"', {}, /must not say "mock"/);
  bad('gh pr edit 5 --body "- ran locally"', {}, /must not say "locally"/);
  ok('gh pr edit 5 --attach "./local-run.png#shot"');
});

test('contract block explains to run the fix separately', () => {
  bad('git push', { contractIssues: () => ['contract T: failing: i1'] }, /separate|own command/);
});
