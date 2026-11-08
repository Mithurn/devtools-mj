#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'clavis-local';
const PORT = Number(process.env.DBHUB_CHECK_PORT ?? 8765);
const READY_TIMEOUT_MS = 90_000;
const here = dirname(fileURLToPath(import.meta.url));
const cfg = join(tmpdir(), `dbhub-check-${SOURCE}.toml`);
const envFile = process.env.DBHUB_ENV_FILE ?? join(homedir(), '.config', 'devtools-mj', '.env');

const script = `
set -a; [ -f "${envFile}" ] && . "${envFile}"; set +a
awk -v id="${SOURCE}" 'BEGIN{RS="";ORS="\\n\\n"} index($0,"id = \\"" id "\\"")||index($0,"source = \\"" id "\\"")' "${join(here, '..', 'tools', 'dbhub', 'dbhub.toml')}" > "${cfg}"
exec npx -y @bytebase/dbhub@1.6.0 --config "${cfg}" --transport http --port ${PORT}
`;
const child = spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', d => (log += d));
child.stderr.on('data', d => (log += d));
const stop = code => { child.kill(); process.exit(code); };

const url = `http://127.0.0.1:${PORT}/mcp`;
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let session;
const rpc = async (body, withSession = true) => {
  const res = await fetch(url, { method: 'POST', headers: { ...headers, ...(withSession && session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
  session ??= res.headers.get('mcp-session-id') ?? undefined;
  const text = await res.text();
  const data = /^data: (.*)$/m.exec(text)?.[1] ?? text;
  try { return JSON.parse(data); } catch { return { raw: text.slice(0, 300) }; }
};

const waitReady = async () => {
  const end = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`dbhub exited early:\n${log.split('\n').filter(l => !/password/i.test(l)).slice(-6).join('\n')}`);
    try { await fetch(`http://127.0.0.1:${PORT}/`); return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('dbhub did not start in time');
};

const sqlResult = r => JSON.stringify(r.result ?? r.error ?? r).slice(0, 220);

try {
  await waitReady();
  await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'readonly-check', version: '1' } } }, false);
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id, sql) => rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: `execute_sql_${SOURCE.replace(/-/g, '_')}`, arguments: { sql } } });
  const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = (tools.result?.tools ?? []).map(t => t.name);
  const toolName = names.find(n => n.startsWith('execute_sql')) ?? 'execute_sql';
  const run = (id, sql) => rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: { sql } } });
  const read = await run(3, 'select 1 as ok');
  const write = await run(4, 'create table dbhub_readonly_probe (a int)');
  const drop = await run(5, "select to_regclass('public.dbhub_readonly_probe') as probe");
  console.log(`tools: ${names.join(', ')}`);
  console.log(`read  select 1        -> ${sqlResult(read)}`);
  console.log(`write create table    -> ${sqlResult(write)}`);
  console.log(`probe table exists?   -> ${sqlResult(drop)}`);
  const refused = /read.?only|not allowed|blocked|forbidden/i.test(JSON.stringify(write)) || write.result?.isError || write.error;
  console.log(refused ? 'RESULT: write was refused, read-only guard holds' : 'RESULT: WRITE WAS NOT REFUSED, do not trust the guard');
  stop(refused ? 0 : 3);
} catch (e) {
  console.error(e.message);
  stop(1);
}
