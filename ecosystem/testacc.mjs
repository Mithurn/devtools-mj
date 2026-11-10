#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { workspaceRoot } from '../tools/contract/lib.mjs';

const FILE = process.env.TESTACC_FILE ?? join(workspaceRoot(), 'notes', 'test accs.md');
const USAGE = `usage: testacc list | testacc run <platform> -- <command...>
run starts the command with TESTACC_EMAIL, TESTACC_PASSWORD and TESTACC_KEY set from notes/test accs.md. Values are never printed.`;
const FIELD = [
  ['EMAIL', /^(?:id|e-?mail|username)$/i],
  ['PASSWORD', /^(?:pass(?:word)?)$/i],
  ['KEY', /^(?:api[ _-]?key|key|\w*_key|token)$/i],
];

export const parse = text => {
  const out = {};
  let cur;
  for (const raw of text.split('\n')) {
    const head = /^([A-Za-z][\w ]*?):\s*$/.exec(raw.trim());
    if (head && !raw.startsWith(' ')) { cur = head[1].toLowerCase(); out[cur] = {}; continue; }
    if (!cur) continue;
    const m = /^[-\s"]*([\w ]+?)"?\s*:\s*"?([^\s",]+)/.exec(raw);
    if (!m) continue;
    const slot = FIELD.find(([, re]) => re.test(m[1].trim()))?.[0];
    if (slot && !out[cur][slot]) out[cur][slot] = m[2];
  }
  return out;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, platform, sep, ...command] = process.argv.slice(2);
  const accounts = parse(readFileSync(FILE, 'utf8'));
  if (cmd === 'list') {
    for (const [k, v] of Object.entries(accounts)) console.log(k, Object.keys(v).join(','));
  } else if (cmd === 'run' && platform && sep === '--' && command.length) {
    const a = accounts[platform.toLowerCase()];
    if (!a) { console.error(`no account named ${platform}; known: ${Object.keys(accounts).join(', ')}`); process.exit(1); }
    const env = { ...process.env, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`TESTACC_${k}`, v])) };
    process.exit(spawnSync(command[0], command.slice(1), { stdio: 'inherit', env }).status ?? 1);
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}
