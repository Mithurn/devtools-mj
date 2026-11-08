#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const FILE = join(homedir(), '.config', 'devtools-mj', 'audit.jsonl');
const MAX_CHARS = 300;
const TOKEN_LIKE = /eyJ[\w-]+\.[\w-]+\.[\w-]+|sntrys_\S+|(?<![\w/.-])[A-Za-z0-9+=_-]{28,}/g;

try {
  const i = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const raw = i.tool_input?.command ?? i.tool_input?.sql ?? JSON.stringify(i.tool_input ?? {});
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), tool: i.tool_name, cwd: i.cwd, input: String(raw).replace(TOKEN_LIKE, '<redacted>').slice(0, MAX_CHARS) }) + '\n');
} catch {}
process.exit(0);
