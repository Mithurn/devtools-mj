import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from './testacc.mjs';

test('parses id, password and key fields per platform', () => {
  const a = parse('pipl:\nid: a@b.com\npass: pw1.\n\ntruly inbox:\nemail: a@b.com\ntestin_key: k123 \n\nhothawk:\n "password": "pk_x",\n  "username": "pk_x"\n');
  assert.deepEqual(a.pipl, { EMAIL: 'a@b.com', PASSWORD: 'pw1.' });
  assert.equal(a['truly inbox'].KEY, 'k123');
  assert.equal(a.hothawk.PASSWORD, 'pk_x');
});
