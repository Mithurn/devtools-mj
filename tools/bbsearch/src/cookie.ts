import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_ENV_FILE } from './config.js';

const COOKIE_NAME = 'bull_board_token';
const JWT = /^bull_board_token=([\w-]+\.[\w-]+\.[\w-]+)$/;

export const decodeJwt = (jwt: string): { email?: string; exp?: number } => {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
};

export const upsertEnvLine = (text: string, key: string, value: string): string => {
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.startsWith(`${key}=`));
  if (i === -1) return `${text.replace(/\n*$/, '\n')}${key}=${value}\n`;
  lines[i] = `${key}=${value}`;
  return lines.join('\n');
};

export const setCookie = (board: string, clipboard?: string): string => {
  const raw = (clipboard ?? execFileSync('pbpaste', { encoding: 'utf8' })).trim();
  const value = raw.startsWith(`${COOKIE_NAME}=`) ? raw : `${COOKIE_NAME}=${raw}`;
  const m = JWT.exec(value);
  if (!m) throw new Error(`clipboard does not hold a ${COOKIE_NAME} token, copy it from the board page first`);
  const { exp, email } = decodeJwt(m[1]);
  if (exp && exp * 1000 < Date.now()) throw new Error('that token has already expired');
  const file = process.env.BBSEARCH_ENV_FILE ?? DEFAULT_ENV_FILE;
  const key = `BBSEARCH_${board.toUpperCase().replace(/-/g, '_')}_COOKIE`;
  writeFileSync(file, upsertEnvLine(existsSync(file) ? readFileSync(file, 'utf8') : '', key, value), { mode: 0o600 });
  const hours = exp ? Math.round((exp * 1000 - Date.now()) / 3_600_000) : '?';
  return `${key} updated for ${email ?? 'unknown user'}, valid about ${hours}h`;
};
