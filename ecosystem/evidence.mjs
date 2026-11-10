#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { workspaceRoot } from '../tools/contract/lib.mjs';

const DEFAULT_WIDTHS = [390, 768, 1280];
const DEFAULT_HEIGHT = 800;
const SETTLE_MS = 800;
const TERM_WIDTH = 1000;
const TERM_SUFFIX = '.term.png';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost|[^.]+\.test)$/;
const USAGE = `usage: evidence shot <url> <out.png> [--width 1280] [--height 800] [--full]
       evidence shots <url> <outdir> [--widths 390,768,1280] [--full]
       evidence term <file|-> <out>.term.png [--width 1000]   (for notes only, never attached to a PR)
       evidence attach <pr> <file>... [--repo owner/name] [--yes]
term renders command output (a text file or stdin) as one image.
Screenshots only for local hosts (localhost, 127.0.0.1, *.localhost, *.test) unless --allow-host is given.
attach prints the gh command and runs it only with --yes (it uploads images into the PR body).`;

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--full', '--yes'].includes(args[i - 1])));
const [cmd, ...rest] = positional;

const chromium = () => {
  const bases = [process.env.EVIDENCE_PLAYWRIGHT_DIR, join(workspaceRoot(), 'clavis'), join(workspaceRoot(), 'zapmail-fe-nextjs')].filter(Boolean);
  for (const b of bases) {
    try {
      return createRequire(join(b, 'package.json'))('playwright').chromium;
    } catch {}
  }
  throw new Error('playwright not found; set EVIDENCE_PLAYWRIGHT_DIR to a folder with node_modules/playwright');
};

const checkHost = url => {
  const host = new URL(url).hostname;
  if (!LOCAL_HOST.test(host) && !flag('--allow-host')) throw new Error(`refusing ${host}: screenshots are for local dev hosts (add --allow-host to override)`);
};

const shoot = async (browser, url, out, width, height, full) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: full });
  await page.close();
  console.log(out);
};

try {
  if (cmd === 'shot' || cmd === 'shots') {
    const [url, out] = rest;
    if (!url || !out) throw new Error(USAGE);
    checkHost(url);
    const browser = await chromium().launch();
    try {
      if (cmd === 'shot') await shoot(browser, url, resolve(out), Number(val('--width', 1280)), Number(val('--height', DEFAULT_HEIGHT)), flag('--full'));
      else for (const w of String(val('--widths', DEFAULT_WIDTHS.join(','))).split(',').map(Number)) await shoot(browser, url, join(resolve(out), `w${w}.png`), w, DEFAULT_HEIGHT, flag('--full'));
    } finally {
      await browser.close();
    }
  } else if (cmd === 'term') {
    const [file, out] = rest;
    if (!file || !out) throw new Error(USAGE);
    if (!out.endsWith(TERM_SUFFIX)) throw new Error(`name the output *${TERM_SUFFIX}: rendered text is not real evidence and PR attach refuses it`);
    const text = readFileSync(file === '-' ? 0 : file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const browser = await chromium().launch();
    try {
      const page = await browser.newPage({ viewport: { width: Number(val('--width', TERM_WIDTH)), height: 200 } });
      await page.setContent(`<body style="margin:0;background:#111;color:#ddd"><pre style="margin:0;padding:16px;font:13px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word">${esc}</pre></body>`);
      mkdirSync(dirname(resolve(out)), { recursive: true });
      await page.screenshot({ path: resolve(out), fullPage: true });
      console.log(resolve(out));
    } finally {
      await browser.close();
    }
  } else if (cmd === 'attach') {
    const [pr, ...files] = rest;
    if (!pr || !files.length) throw new Error(USAGE);
    for (const f of files) if (!existsSync(f)) throw new Error(`missing file ${f}`);
    const fake = files.filter(f => f.endsWith(TERM_SUFFIX));
    if (fake.length) throw new Error(`refusing to attach rendered text (${fake.join(', ')}): PR images must be real screenshots of the Bull Board, the app or the admin panel`);
    const ghArgs = ['pr', 'edit', pr, ...(val('--repo') ? ['--repo', val('--repo')] : []), ...files.flatMap(f => ['--attach', `${resolve(f)}#${basename(f, '.png')}`])];
    if (!flag('--yes')) console.log(`dry run, would run: gh ${ghArgs.join(' ')}`);
    else console.log(execFileSync('gh', ghArgs, { encoding: 'utf8' }));
  } else {
    console.error(USAGE);
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
