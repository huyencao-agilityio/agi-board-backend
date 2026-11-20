#!/usr/bin/env node
// Claude Code hooks for agi-board-backend (wired in .claude/settings.json).
// Usage: node guard.mjs <pre-bash|pre-file|post-file|post-bash|post-bash-fail|stop>  (hook JSON on stdin)
// Self-test: node --test .claude/hooks/guard.test.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROTECTED_BRANCHES = ['main', 'develop'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'host.docker.internal']);
const ENV_RANK = { local: 0, test: 0, unknown: 0, staging: 1, remote: 2, production: 3 };

// ---------- database environment ----------

export function classifyDbUrl(url, nodeEnv) {
  if (nodeEnv === 'production') return 'production';
  if (!url) return 'unknown';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'unknown';
  }
  const host = u.hostname.toLowerCase();
  const text = `${host}/${u.pathname.slice(1).toLowerCase()}`;
  if (/prod/.test(text)) return 'production';
  if (/stag|stg/.test(text)) return 'staging';
  if (LOCAL_HOSTS.has(host)) return text.endsWith('_test') ? 'test' : 'local';
  return 'remote';
}

/** Worst environment the command can reach: URLs written in the command win over .env. */
function targetEnv(cmd, dotenv) {
  const nodeEnv = /\bNODE_ENV=['"]?production\b/.test(cmd) ? 'production' : dotenv.NODE_ENV;
  const urls = cmd.match(/postgres(?:ql)?:\/\/[^\s'"]+/g) ?? [dotenv.DATABASE_URL ?? process.env.DATABASE_URL];
  return urls.map((u) => classifyDbUrl(u, nodeEnv)).reduce((a, b) => (ENV_RANK[b] > ENV_RANK[a] ? b : a), 'unknown');
}

// ---------- PreToolUse: Bash ----------

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });
const ENV_FILE = /(^|[\s'"=/:<>])\.env(?!\.example\b)(\.[\w.-]+)?(?=$|[\s'";|&)<>])/;
const WRITE_OP = /\b(rm|mv|truncate|tee|shred|unlink)\b|\bsed\s+(-\w+\s+)*-i|\bperl\s+-\w*i|>/;

function checkGitPush(seg, ctx) {
  const args = seg
    .slice(seg.search(/\bpush\b/) + 4)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (args.some((a) => /^(--force(-with-lease|-if-includes)?(=.*)?|-[a-zA-Z]*f[a-zA-Z]*)$/.test(a)))
    return deny(
      'Force push is blocked (including --force-with-lease). Ask the user to do it by hand if really needed.',
    );
  if (args.some((a) => a === '--mirror' || a === '--delete' || a === '-d' || /^\+/.test(a) || /^:/.test(a)))
    return deny('Pushes that rewrite or delete remote refs (+refspec, :branch, --delete, --mirror) are blocked.');
  const refs = args.filter((a) => !a.startsWith('-')).slice(1); // first non-flag is the remote
  const targets =
    refs.length === 0 || refs.includes('HEAD') ? [ctx.currentBranch] : refs.map((r) => r.split(':').pop());
  const hit = targets.find((t) => PROTECTED_BRANCHES.includes(String(t).replace(/^refs\/heads\//, '')));
  if (hit) return deny(`Direct push to '${hit}' is blocked. Push a <type>/<slug> branch and open a PR into develop.`);
  return null;
}

/** Returns { decision: 'deny' | 'ask', reason } or null to let the normal permission flow decide. */
export function checkBash(cmd, ctx = {}) {
  const { currentBranch = '', dotenv = {}, isTracked = () => false } = ctx;
  const c = cmd.replace(/\d?>&\d|>\s*\/dev\/null/g, ' '); // fd duplication is not a file write

  // --- git ---
  for (const seg of c.split(/&&|\|\||;|\||\n/)) {
    if (!/\bgit\b/.test(seg)) continue;
    if (/\bgit\b.*\bpush\b/.test(seg)) {
      const r = checkGitPush(seg, { currentBranch });
      if (r) return r;
    }
    if (
      /\bgit\b.*\b(filter-branch|filter-repo)\b|\breflog\s+expire\b|\bgc\b.*--prune=now|\bupdate-ref\s+-d\b/.test(seg)
    )
      return deny('History-rewriting / ref-deleting git commands are blocked.');
    if (/\bgit\b.*\bbranch\b.*(\s-[a-zA-Z]*[dD]\b|--delete).*\b(main|develop)\b/.test(seg))
      return deny('Deleting main or develop is blocked.');
    if (/\bgit\b.*\breset\b.*--hard\b/.test(seg)) return ask('git reset --hard discards uncommitted work.');
    if (/\bgit\b.*\bclean\b.*\s-[a-zA-Z]*f/.test(seg))
      return ask('git clean -f deletes untracked files (new migrations included).');
    if (
      /\bgit\b.*\bcheckout\b.*(\s--\s|\s\.(\s|$))/.test(seg) ||
      (/\bgit\b.*\brestore\b/.test(seg) && !/--staged/.test(seg))
    )
      return ask('This discards working-tree changes.');
    if (/\bgit\b.*\bstash\s+(drop|clear)\b/.test(seg)) return ask('This deletes stashed work.');
    if (/\bgit\b.*\bbranch\b.*\s-D\b/.test(seg)) return ask('git branch -D deletes an unmerged branch.');
  }
  if (/\bgit\b.*--no-verify\b|\bHUSKY=0\b/.test(c))
    return deny('Bypassing husky hooks (--no-verify, HUSKY=0) is not allowed (commitlint / branch-name checks).');

  // --- files ---
  if (ENV_FILE.test(c)) return deny('Commands that read or write .env files are blocked (secrets). Ask the user.');
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\.git|\*|\.|\.\.)(\/)?(\s|$)/.test(c))
    return deny('Recursive delete of the repo, home or root is blocked.');
  if (WRITE_OP.test(c)) {
    const migPaths = c.match(/prisma\/migrations[^\s'";|&)]*/g) ?? [];
    if (migPaths.some((p) => /migration_lock\.toml/.test(p) || /^prisma\/migrations\/?$/.test(p) || isTracked(p)))
      return deny('Committed migrations are immutable. Create a new one with `pnpm db:migrate:new <name>`.');
  }

  // --- database ---
  if (/\bprisma\s+migrate\s+reset\b|\bdb:reset\b/.test(c))
    return deny(
      '`prisma migrate reset` / `pnpm db:reset` wipe the database. Ask the user to run it (Prisma blocks AI agents too).',
    );
  if (/\bprisma\s+db\s+push\b/.test(c))
    return deny('`prisma db push` bypasses migrations. Use `pnpm db:migrate:new <name>`.');
  if (
    /\bdocker\b.*\b(compose|-compose)\b.*\bdown\b.*(\s-v\b|--volumes)|\bdocker\s+(volume\s+(rm|prune)|system\s+prune\b.*--volumes)/.test(
      c,
    )
  )
    return ask('This deletes the local PostgreSQL volume (all local data).');

  const dbWrite =
    /\bprisma\s+(migrate\s+(deploy|dev|resolve)|db\s+(execute|seed))\b|\bdb:(migrate|migrate:dev|seed)(?![\w:])|\b(psql|pg_restore|dropdb|createdb)\b/;
  if (dbWrite.test(c)) {
    const env = targetEnv(c, dotenv);
    if (env === 'production' || env === 'remote')
      return deny(
        `This database command targets a ${env} database. Only local/test databases may be changed from here.`,
      );
    if (env === 'staging') return ask('This database command targets a staging database.');
    const destructiveSql =
      /\b(drop\s+(database|schema|table|column|index|constraint|type|view)\b|truncate\b|delete\s+from\s+[\w."]+\s*(;|$|['"])|alter\s+table\s+[^;]*\bdrop\b)/i;
    if (/\bdropdb\b/.test(c) || destructiveSql.test(c)) return ask('Destructive SQL against the local database.');
    if (/\bprisma\s+migrate\s+resolve\b/.test(c))
      return ask('`prisma migrate resolve` edits the migration history table.');
  }
  return null;
}

// ---------- PreToolUse: Edit / Write ----------

export function checkFile(rel, ctx = {}) {
  const { isTracked = () => false } = ctx;
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  if (/(^|\/)\.env(\.[\w.-]+)?$/.test(rel) && !rel.endsWith('.env.example'))
    return deny('.env files hold secrets; edit them by hand. Template changes go in .env.example.');
  if (rel === 'prisma/migrations/migration_lock.toml') return deny('migration_lock.toml is managed by Prisma.');
  const mig = rel.match(/^prisma\/migrations\/[^/]+/);
  if (mig && isTracked(mig[0]))
    return deny(
      `${mig[0]} is committed (possibly applied in other environments). Never edit an applied migration; create a new one with \`pnpm db:migrate:new <name>\`.`,
    );
  if (/^src\/generated\//.test(rel))
    return deny('src/generated is the Prisma client output; change prisma/schema and run `pnpm prisma generate`.');
  if (/^(dist|node_modules|coverage)\//.test(rel)) return deny('Build output / dependencies are not edited by hand.');
  if (rel === 'pnpm-lock.yaml') return deny('pnpm-lock.yaml is changed only through pnpm commands.');
  if (
    /^(\.husky|\.github|docker)\//.test(rel) ||
    /^\.claude\/(settings\.json|hooks\/)/.test(rel) ||
    /^(commitlint\.config\.mjs|eslint\.config\.mjs|\.prettierrc|\.prettierignore|tsconfig.*\.json|Dockerfile|docker-compose\.yml|prisma\.config\.ts|scripts\/check-branch-name\.sh|\.nvmrc)$/.test(
      rel,
    )
  )
    return ask(`${rel} is shared tooling / CI / safety configuration.`);
  return null;
}

// ---------- PostToolUse: migration conventions ----------

/** Names of hand-written objects (blocks that start with `-- manual:`) in committed migrations. */
function manualObjectNames() {
  const names = new Set();
  const dir = join(ROOT, 'prisma/migrations');
  for (const d of existsSync(dir) ? readdirSync(dir) : []) {
    const f = join(dir, d, 'migration.sql');
    if (!existsSync(f)) continue;
    for (const block of readFileSync(f, 'utf8').split(/\n\s*\n/)) {
      if (!block.trimStart().startsWith('-- manual:')) continue;
      for (const m of block.matchAll(/\b(?:CONSTRAINT|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) names.add(m[1]);
    }
  }
  return names;
}

export function validateMigration(rel, sql, manualNames = new Set()) {
  const errors = [];
  const warnings = [];
  const dir = rel.split('/')[2];
  if (!/^\d{14}_[a-z0-9_]+$/.test(dir))
    warnings.push(
      `folder '${dir}' is not <timestamp>_<snake_name>; create migrations with \`pnpm db:migrate:new <name>\`.`,
    );
  if (!sql.trim()) warnings.push('migration.sql is empty.');
  for (const m of sql.matchAll(/\bDROP\s+(?:INDEX|CONSTRAINT)\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi))
    if (manualNames.has(m[1]))
      errors.push(
        `drops hand-written object '${m[1]}' (a \`-- manual:\` object). Re-create it at the end of this migration and keep test/schema.e2e-spec.ts in sync.`,
      );
  const risky = sql.match(
    /\b(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+[^;]*\bTYPE\b)/gi,
  );
  if (risky)
    warnings.push(
      `contains data-losing statements: ${[...new Set(risky.map((s) => s.toUpperCase().split(/\s+/).slice(0, 2).join(' ')))].join(', ')}. Confirm this is intended.`,
    );
  if (/\b(CHECK\s*\(|NULLS\s+NOT\s+DISTINCT|DEFERRABLE|USING\s+gin|ON\s+\w+\s*\(\s*lower\()/i.test(sql))
    warnings.push('adds an object Prisma cannot express: mark it `-- manual:` and add it to test/schema.e2e-spec.ts.');
  return { errors, warnings };
}

// ---------- PostToolUse: Bash (which checks passed) ----------

const CHECKS = ['lint', 'typecheck', 'test', 'test:e2e', 'db:check'];
/** Checks a command ran in full whose exit code is the command's own (not piped, not `; other`). */
export function checksInCommand(cmd) {
  const re = /\bpnpm\s+(?:run\s+)?(lint|typecheck|test:e2e|test|db:check)(?![\w:-])(?=\s*(?:2>&1\s*)?(?:$|&&))/g;
  return [...cmd.matchAll(re)].map((m) => m[1]);
}

// ---------- Stop: required checks ----------

export function requiredChecks(files) {
  const req = new Set(['lint', 'typecheck', 'test']);
  if (files.some((f) => f.startsWith('prisma/'))) req.add('db:check');
  if (
    files.some((f) =>
      /^(prisma|test)\/|^src\/(database|common|modules\/permissions)\/|^src\/(main|app\.module)\.ts$|\.(controller|module|guard)\.ts$/.test(
        f,
      ),
    )
  )
    req.add('test:e2e');
  return CHECKS.filter((c) => req.has(c));
}

// ---------- runtime helpers ----------

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const isTracked = (p) => git('log', '--all', '-1', '--format=%H', '--', p.replace(/\/+$/, '')) !== '';
const SCOPE = ['src', 'test', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.mjs'];

/** Hash of the code that checks look at, so "checks passed" is tied to an exact tree state. */
function fingerprint() {
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...SCOPE)
    .split('\n')
    .filter(Boolean);
  const h = createHash('sha256')
    .update(git('rev-parse', 'HEAD'))
    .update(git('diff', 'HEAD', '--', ...SCOPE));
  for (const f of untracked) h.update(f).update(existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f)) : '');
  const files = [
    ...git('diff', 'HEAD', '--name-only', '--', ...SCOPE)
      .split('\n')
      .filter(Boolean),
    ...untracked,
  ];
  return { hash: h.digest('hex'), files };
}

function readDotenv() {
  const out = {};
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    /* no .env */
  }
  return out;
}

const stateFile = (sid) =>
  join(tmpdir(), 'claude-hooks-agi-board-backend', `${String(sid || 'default').replace(/[^\w-]/g, '')}.json`);
function loadState(sid) {
  try {
    return JSON.parse(readFileSync(stateFile(sid), 'utf8'));
  } catch {
    return { passes: {} };
  }
}
function saveState(sid, st) {
  mkdirSync(dirname(stateFile(sid)), { recursive: true });
  writeFileSync(stateFile(sid), JSON.stringify(st));
}

const out = (obj) => process.stdout.write(JSON.stringify(obj));
const preDecision = (r) =>
  out({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: r.decision,
      permissionDecisionReason: `[guard] ${r.reason}`,
    },
  });
const relPath = (p) =>
  relative(ROOT, isAbsolute(p) ? p : resolve(ROOT, p))
    .split('\\')
    .join('/');

function run(bin, args) {
  try {
    execFileSync(join(ROOT, 'node_modules/.bin', bin), args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 25000,
    });
    return null;
  } catch (e) {
    return String(e.stderr || e.stdout || e.message)
      .trim()
      .slice(0, 2000);
  }
}

async function main(mode) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  const sid = input.session_id;
  const st = loadState(sid);
  if (!st.baseline) {
    st.baseline = fingerprint().hash; // first hook call of the session = state before Claude changed anything
    saveState(sid, st);
  }
  const ti = input.tool_input ?? {};

  if (mode === 'pre-bash') {
    const r = checkBash(ti.command ?? '', {
      currentBranch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      dotenv: readDotenv(),
      isTracked,
    });
    if (r) preDecision(r);
    return;
  }
  if (mode === 'pre-file') {
    const r = checkFile(relPath(ti.file_path ?? ti.notebook_path ?? ''), { isTracked });
    if (r) preDecision(r);
    return;
  }
  if (mode === 'post-file') {
    const rel = relPath(ti.file_path ?? '');
    if (rel.startsWith('..')) return;
    const errors = [];
    const notes = [];
    if (/\.(ts|js|mjs|cjs|json|md|ya?ml)$/.test(rel)) {
      const err = run('prettier', ['--write', '--ignore-unknown', '--log-level', 'warn', rel]);
      if (err) errors.push(`prettier could not format ${rel} (syntax error?):\n${err}`);
    }
    if (/^prisma\/schema\/.*\.prisma$/.test(rel)) {
      const err = run('prisma', ['format']);
      if (err) errors.push(`prisma format failed (schema invalid):\n${err}`);
      else
        notes.push(
          'Prisma schema changed: create the migration with `pnpm db:migrate:new <name>`, read the generated SQL, then `pnpm db:check`.',
        );
    }
    if (/^prisma\/migrations\/[^/]+\/migration\.sql$/.test(rel)) {
      const v = validateMigration(rel, readFileSync(join(ROOT, rel), 'utf8'), manualObjectNames());
      errors.push(...v.errors.map((e) => `migration ${e}`));
      notes.push(...v.warnings.map((w) => `migration ${w}`));
    }
    if (errors.length) out({ decision: 'block', reason: `[guard] ${[...errors, ...notes].join('\n')}` });
    else if (notes.length)
      out({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[guard] ${notes.join('\n')}` } });
    return;
  }
  if (mode === 'post-bash' || mode === 'post-bash-fail') {
    const ran = checksInCommand(ti.command ?? '');
    if (!ran.length) return;
    const resp = input.tool_response ?? {};
    const failed = mode === 'post-bash-fail' || resp.interrupted || Number(resp.exitCode ?? resp.exit_code ?? 0) !== 0;
    const fp = fingerprint().hash;
    for (const c of ran) {
      if (failed) delete st.passes[c];
      else st.passes[c] = fp;
    }
    saveState(sid, st);
    return;
  }
  if (mode === 'stop') {
    const fp = fingerprint();
    if (fp.hash === st.baseline || fp.files.length === 0) return; // nothing changed in this session
    const missing = requiredChecks(fp.files).filter((c) => st.passes[c] !== fp.hash);
    if (!missing.length) return;
    const list = missing.map((c) => `pnpm ${c}`).join(', ');
    if (input.stop_hook_active) {
      out({ systemMessage: `[guard] Not verified on the current code: ${list}. Do not treat the task as checked.` });
      return;
    }
    out({
      decision: 'block',
      reason:
        `[guard] Code changed but these checks have not passed on the current tree: ${list}. ` +
        'Run each one directly (no pipe to tail/grep, so its exit code counts) and fix failures. ' +
        'If a check cannot run (e.g. database down), stop and tell the user exactly which check did not run and why; never say it passed.',
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((e) => {
    process.stderr.write(`[guard] hook error: ${e.message}\n`); // non-blocking: a broken hook must not lock the session
    process.exit(1);
  });
}
