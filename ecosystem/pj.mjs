#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PJ_BASE_URL ?? 'https://pandora-jar.outbox.vc';
const BLOCKED_ENVS = ['production', 'prod'];
const USAGE = `usage: pj keys|run|diff --env <slug> [--project <dir>] [-- cmd...]
  keys           print secret names for the environment (never values)
  run -- cmd     run cmd with the environment's secrets loaded
  diff <file>    compare secret names with a local env file (names only)
production is blocked on purpose.`;

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const head = sep === -1 ? argv : argv.slice(0, sep);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);
const [action, ...rest] = head;
const opt = name => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const env = opt('--env');
if (!action || !env) { console.error(USAGE); process.exit(1); }
if (BLOCKED_ENVS.includes(env.toLowerCase())) { console.error('pj: production is blocked'); process.exit(1); }

const dir = opt('--project') ?? process.cwd();
const workspaceId = JSON.parse(readFileSync(join(dir, '.infisical.json'), 'utf8')).workspaceId;
const token = execFileSync('infisical', ['user', 'get', 'token', '--plain', '--silent'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();

const url = `${BASE}/api/v3/secrets/raw?workspaceId=${workspaceId}&environment=${encodeURIComponent(env)}&secretPath=%2F&expand_secret_references=true&include_imports=true`;
const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`pj: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const body = await res.json();
const secrets = new Map();
for (const imp of body.imports ?? []) for (const s of imp.secrets ?? []) secrets.set(s.secretKey, s.secretValue);
for (const s of body.secrets ?? []) secrets.set(s.secretKey, s.secretValue);

if (action === 'keys') {
  console.log([...secrets.keys()].sort().join('\n'));
} else if (action === 'diff') {
  const file = rest.find(a => !a.startsWith('--') && a !== env && a !== dir);
  const local = new Set(readFileSync(file, 'utf8').split('\n').map(l => /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(l)?.[1]).filter(Boolean));
  const missing = [...secrets.keys()].filter(k => !local.has(k)).sort();
  const extra = [...local].filter(k => !secrets.has(k)).sort();
  console.log(`${env}: ${secrets.size} secrets, local file: ${local.size} keys`);
  console.log(`missing locally (${missing.length}): ${missing.join(' ') || '-'}`);
  console.log(`only local (${extra.length}): ${extra.join(' ') || '-'}`);
} else if (action === 'run') {
  if (!cmd.length) { console.error(USAGE); process.exit(1); }
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...Object.fromEntries(secrets), INFISICAL_ENVIRONMENT: env } });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  console.error(USAGE); process.exit(1);
}
