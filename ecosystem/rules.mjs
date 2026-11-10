const BANNED_IN_TEXT = [
  [/—/, 'em dash (use commas or separate sentences)'],
  [/co-authored-by:/i, 'Co-Authored-By trailer'],
  [/generated with \[?claude code/i, '"Generated with Claude Code" footer'],
  [/claude\.ai\/code\/session/i, 'Claude session link'],
  [/claude-session:/i, 'Claude-Session trailer'],
];
const PR_TEXT_WORDS = /\b(mock(?:s|ed|ing)?|locally|local|localhost)\b/i;
const MAX_PR_COMMENTS = 1;
const CONTRACT_HINT = 'contract problems block push, PR and merge: run the fix as its own command first, then run the push alone';
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([\w./-]+\))?!?: \S/;
const PROTECTED_BRANCH = /^(main|master|staging|production|prod)$/;
const BRANCH_POLICY = /^(mithurn|feature)\/[a-z0-9][a-z0-9._/-]*$/;
const TICKET_ID_IN_BRANCH = /(^|[/-])(cu-[a-z0-9]+|14ze[a-z0-9]{6,}|86[a-z0-9]{7,9})($|[/-])/i;
const MERGE_BASE_ALLOWED = 'staging';
const RUNNER = String.raw`(?:(?:npx|pnpm\s+(?:dlx|exec)|yarn|bunx|pandora-jar\s+run(?:\s+--env\s+\S+)?(?:\s+--)?)\s+(?:-\S+\s+)*)*`;
const STMT = String.raw`(^|[;&|(\n]\s*)(?:\w+=\S+\s+)*${RUNNER}`;

export const bareOf = command =>
  command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' ');

const verb = (bare, re) => new RegExp(STMT + re).test(bare);

const NEVER = [
  [String.raw`gh\s+workflow\s+run\b`, 'running workflows (deploys) is for humans'],
  [String.raw`gh\s+release\s+create\b`, 'creating releases is for humans'],
  [String.raw`npm\s+publish\b`, 'publishing packages is for humans'],
  [String.raw`vercel\b[^;&|\n]*--prod\b`, 'production deploy'],
  [String.raw`[^;&|\n]*\bdeploy\b[^;&|\n]*--env[= ]+(prod|production)\b`, 'production deploy'],
  [String.raw`prisma\s+(migrate\s+(deploy|dev)|db\s+push)\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`drizzle-kit\s+push\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`supabase\s+db\s+push\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`alembic\s+upgrade\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`rails\s+db:migrate\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`(sequelize|sequelize-cli)\s+db:migrate\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`typeorm\s+migration:run\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`knex\s+migrate:(latest|up)\b`, 'schema migration (a lead applies migrations)'],
  [String.raw`[^;&|\n]*sync-db\.ts`, 'sync-db alters the schema (a lead runs it)'],
];
const TRIGGER_DEPLOY = new RegExp(STMT + String.raw`(npx\s+)?(trigger\.dev(@\S+)?)\s+deploy\b(?![^;&|\n]*--env[= ]+staging\b)`);
const SQL_WRITE = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+(table|schema|database)|alter\s+table|create\s+(table|index|schema)|truncate)\b/i;
const LOCAL_HOST = /(localhost|127\.0\.0\.1|\[::1\])/;

export const evaluate = (command, ctx) => {
  const bare = bareOf(command);
  const issues = [];
  const cwd = ctx.cwd ?? '';
  const isCommit = verb(bare, String.raw`git\s+(?:-C\s+\S+\s+)?commit\b`);
  const isPush = verb(bare, String.raw`git\s+(?:-C\s+\S+\s+)?push\b`);
  const isPrCreate = verb(bare, String.raw`gh\s+pr\s+create\b`);
  const isPrEdit = verb(bare, String.raw`gh\s+pr\s+edit\b`);
  const isPrComment = verb(bare, String.raw`gh\s+pr\s+comment\b`);
  const isMerge = verb(bare, String.raw`gh\s+pr\s+merge\b`);

  if (!cwd.includes('xeno-grow')) {
    for (const [re, why] of NEVER) if (verb(bare, re)) issues.push(`blocked: ${why}`);
  } else {
    for (const [re, why] of NEVER.slice(0, 5)) if (verb(bare, re)) issues.push(`blocked: ${why}`);
  }
  if (TRIGGER_DEPLOY.test(bare)) issues.push('blocked: trigger.dev deploy needs an explicit --env staging');
  if (verb(bare, String.raw`psql\b`) && SQL_WRITE.test(command) && !LOCAL_HOST.test(command)) issues.push('blocked: psql write against a non-local database');

  if (isCommit || isPrCreate || isPrEdit || isPrComment) {
    for (const [re, why] of BANNED_IN_TEXT) if (re.test(command)) issues.push(`${isCommit ? 'commit message' : 'PR text'} contains ${why}`);
  }
  if (isPrCreate || isPrEdit || isPrComment) {
    const text = command.replace(/--attach\s+("[^"]*"|'[^']*'|\S+)/g, '');
    const w = PR_TEXT_WORDS.exec(text)?.[0];
    if (w) issues.push(`PR text must not say "${w}" (describe the change, not how it was tested)`);
  }
  if (isPrComment) {
    if (ctx.prCommentCount(command) >= MAX_PR_COMMENTS) issues.push('a PR gets one description and at most one comment: edit the description (gh pr edit) instead of commenting again');
    if (/\n#{1,4} /.test(command)) issues.push('PR comment has headers; short bullets only');
  }
  if (isPrCreate) {
    const m = /(?:--title|-t)\s+(?:"([^"]*)"|'([^']*)')/.exec(command);
    const title = m?.[1] ?? m?.[2];
    if (title && !CONVENTIONAL.test(title)) issues.push(`PR title is not conventional (type(scope): summary): ${title}`);
    if (/\n#{1,4} /.test(command)) issues.push('PR body has headers; use short bullets only');
  }

  const team = ctx.isTeamRepo();
  if (isCommit && team) issues.push(...ctx.diffChecks());
  if (isPush) {
    const args = /git\s+(?:-C\s+\S+\s+)?push([^;&|\n]*)/.exec(bare)?.[1] ?? '';
    if (/(^|\s)(--force|-f)(\s|$)/.test(args)) issues.push('force push is blocked (use --force-with-lease on your own branch if you must)');
    if (team) {
      if (/(^|\s|:)(main|master|staging|production|prod)(\s|$)/.test(args)) issues.push('direct pushes to main, staging or production are blocked, open a PR');
      const branch = ctx.branch();
      if (branch && PROTECTED_BRANCH.test(branch)) issues.push(`current branch is ${branch}, direct pushes are blocked, open a PR`);
      else if (branch && !BRANCH_POLICY.test(branch)) issues.push(`branch name ${branch} should be mithurn/<what-it-does> (or feature/...)`);
      if (branch && TICKET_ID_IN_BRANCH.test(branch)) issues.push(`branch name ${branch} must not contain a ClickUp ID`);
    }
  }
  if (isMerge) {
    if (/--admin\b/.test(bare)) issues.push('gh pr merge --admin is blocked');
    const base = ctx.prBase(command);
    if (base !== MERGE_BASE_ALLOWED) issues.push(`only PRs into ${MERGE_BASE_ALLOWED} may be merged here (this one targets ${base ?? 'unknown'})`);
  }
  if (isPush || isPrCreate || isMerge) {
    const c = ctx.contractIssues();
    if (c.length) issues.push(...c, CONTRACT_HINT);
  }
  return issues;
};
