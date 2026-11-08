import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredBoards, resolveBoards } from '../src/config.js';
import { jobLink, matches, parseTerms, scrub, type JobRecord } from '../src/search.js';

const job: JobRecord = {
  board: 'clavis',
  uiUrl: 'http://h:4015/ui',
  queue: 'exports.accounts',
  state: 'failed',
  id: '42',
  name: 'export',
  data: '{"mailbox":"Jane@Example.com","userId":"u-9"}',
  failedReason: 'login failed for jane@example.com',
  timestamp: 1,
  finishedOn: 2,
};

test('matches by email, user id and job id, case insensitive', () => {
  assert.ok(matches(job, ['jane@example.com']));
  assert.ok(matches(job, ['u-9']));
  assert.ok(matches(job, ['42']));
  assert.ok(!matches(job, ['nobody@example.com']));
});

test('multiple terms are OR', () => {
  assert.ok(matches(job, ['nobody@example.com', 'u-9']));
});

test('parseTerms splits on commas and whitespace', () => {
  assert.deepEqual(parseTerms('A@b.com, c@d.com\nE'), ['a@b.com', 'c@d.com', 'e']);
});

test('scrub masks emails unless raw', () => {
  assert.equal(scrub('fail jane@example.com', false), 'fail <email>');
  assert.equal(scrub('fail jane@example.com', true), 'fail jane@example.com');
});

test('job link points at the board queue page', () => {
  assert.equal(jobLink(job), 'http://h:4015/ui/queue/exports.accounts/42');
  assert.equal(jobLink({ ...job, uiUrl: '' }), '');
});

test('boards resolve in the configured order', () => {
  const env = {
    BULLSEARCH_ZAPMAIL_STAGING_REDIS_URL: 'redis://h:1/0',
    BULLSEARCH_ZAPMAIL_STAGING_PREFIX: 'q',
    BULLSEARCH_ZAPMAIL_STAGING_UI_URL: 'https://s/ui/',
    BULLSEARCH_CLAVIS_REDIS_URL: 'redis://c:1/1',
    BULLSEARCH_BOARDS: 'clavis,zapmail-staging',
  };
  assert.deepEqual(configuredBoards(env).sort(), ['clavis', 'zapmail-staging']);
  const [first, second] = resolveBoards(undefined, env);
  assert.equal(first.name, 'clavis');
  assert.deepEqual(second, { name: 'zapmail-staging', url: 'redis://h:1/0', prefix: 'q', uiUrl: 'https://s/ui' });
  assert.throws(() => resolveBoards('nope', env), /not set/);
});
