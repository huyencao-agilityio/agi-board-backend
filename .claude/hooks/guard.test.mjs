// Run: node --test .claude/hooks/guard.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBash, checkFile, checksInCommand, manualObjects, requiredChecks, validateMigration } from './guard.mjs';

const d = (r) => r?.decision ?? 'allow';
const tracked = (p) => p === 'prisma/migrations/0001_init.sql';
const local = {
  currentBranch: 'feat/x',
  isTracked: tracked,
};

test('git safety', () => {
  for (const c of [
    'git push --force',
    'git push -f origin feat/x',
    'git push --force-with-lease origin feat/x',
    'git push origin +feat/x',
    'git push origin --delete feat/x',
    'git push origin :feat/x',
    'git push origin develop',
    'git push origin HEAD:main',
    'git commit --no-verify -m "x"',
    'HUSKY=0 git commit -m x',
    'git branch -D develop',
    'git filter-branch --all',
  ])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  assert.equal(d(checkBash('git push', { ...local, currentBranch: 'main' })), 'deny');
  assert.equal(d(checkBash('git push -u origin feat/x', local)), 'allow');
  assert.equal(d(checkBash('git push', local)), 'allow');
  for (const c of [
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git checkout -- .',
    'git restore src/a.ts',
    'git stash drop',
  ])
    assert.equal(d(checkBash(c, local)), 'ask', c);
  for (const c of [
    'git status',
    'git diff HEAD',
    'git log --oneline',
    'git restore --staged a.ts',
    'git commit -m "feat(x): #1 Add"',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('file safety via bash', () => {
  for (const c of [
    'cat .env',
    'echo X=1 >> .env',
    'cp .env.local /tmp/a',
    'rm -rf .',
    'rm -rf prisma/migrations',
    "sed -i 's/a/b/' prisma/migrations/0001_init.sql",
  ])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  for (const c of [
    'cat .env.example',
    'cat prisma/migrations/0001_init.sql 2>&1',
    'rm -rf dist',
    'node -e "process.env.X"',
    'rm prisma/migrations/0002_new.sql',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('database safety', () => {
  for (const c of ['pnpm db:reset', 'pnpm prisma migrate reset', 'pnpm prisma db push'])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  for (const c of [
    'pnpm exec wrangler d1 execute DB --local --command "DROP TABLE cards"',
    'pnpm exec wrangler d1 execute DB --local --command "DELETE FROM users"',
    'docker compose down -v',
  ])
    assert.equal(d(checkBash(c, local)), 'ask', c);
  for (const c of [
    'pnpm db:migrate',
    'pnpm db:migrate:new add_x',
    'pnpm db:diff',
    'pnpm db:seed',
    'pnpm db:check',
    'pnpm test:e2e',
    'pnpm exec wrangler d1 execute DB --local --command "select count(*) from users"',
    'docker compose down',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('file protection', () => {
  const ctx = { isTracked: tracked };
  for (const p of [
    '.env',
    '.env.production',
    'prisma/migrations/0001_init.sql',
    'src/generated/prisma/client.ts',
    'pnpm-lock.yaml',
  ])
    assert.equal(d(checkFile(p, ctx)), 'deny', p);
  for (const p of [
    '.husky/pre-push',
    '.github/workflows/ci.yml',
    'commitlint.config.mjs',
    '.claude/settings.json',
    'tsconfig.json',
  ])
    assert.equal(d(checkFile(p, ctx)), 'ask', p);
  for (const p of [
    '.env.example',
    'src/modules/boards/boards.service.ts',
    'prisma/schema/boards.prisma',
    'prisma/migrations/0002_add_x.sql',
    '../agi-board-frontend/.env',
  ])
    assert.equal(d(checkFile(p, ctx)), 'allow', p);
});

test('migration validation', () => {
  const init = [
    'CREATE TABLE "cards" (',
    '    "id" TEXT NOT NULL PRIMARY KEY,',
    '    -- manual',
    '    CONSTRAINT "cards_title_check" CHECK (trim(title) <> \'\')',
    ');',
    'CREATE INDEX "idx_cards_list" ON "cards"("list_id");',
    '',
    '-- manual: expression indexes',
    'CREATE INDEX "idx_users_full_name" ON "users" (lower(full_name));',
  ].join('\n');
  const manual = manualObjects([init]);
  assert.deepEqual(
    [...manual],
    [
      ['cards_title_check', 'cards'],
      ['idx_users_full_name', 'users'],
    ],
  );

  const ok = validateMigration('prisma/migrations/0002_add_x.sql', 'ALTER TABLE "cards" ADD COLUMN "x" TEXT;', manual);
  assert.deepEqual(ok, { errors: [], warnings: [] });

  const bad = validateMigration(
    'prisma/migrations/my-migration.sql',
    'DROP INDEX "idx_users_full_name";\nCREATE TABLE "new_cards" ("id" TEXT);\nDROP TABLE "cards";',
    manual,
  );
  assert.equal(bad.errors.length, 2); // drops a manual index; table rebuild loses cards_title_check
  assert.equal(bad.warnings.length, 2); // file name; data-losing statement

  const rebuilt = validateMigration(
    'prisma/migrations/0003_rebuild_cards.sql',
    'CREATE TABLE "new_cards" (\n  -- manual\n  CONSTRAINT "cards_title_check" CHECK (trim(title) <> \'\')\n);\nDROP TABLE "cards";',
    manual,
  );
  assert.equal(rebuilt.errors.length, 0);
});

test('cloudflare safety', () => {
  for (const c of [
    'pnpm exec wrangler deploy --env production',
    'pnpm wrangler deploy',
    'npx wrangler rollback --env staging',
    'pnpm exec wrangler versions deploy',
    'pnpm exec wrangler secret put API_KEY --env staging',
    'pnpm exec wrangler d1 migrations apply DB --remote --env production',
    'pnpm exec wrangler d1 execute DB --remote --command "DELETE FROM users"',
    'pnpm exec wrangler d1 time-travel restore agi-board-production --timestamp 1',
    'pnpm exec wrangler r2 bucket delete agi-board-images-production',
    'pnpm exec wrangler d1 delete agi-board-staging',
    'sh scripts/upload-backgrounds.sh --remote --env production',
  ])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  for (const c of [
    'pnpm exec wrangler d1 execute DB --remote --env staging --file prisma/seed.sql',
    'pnpm exec wrangler d1 create agi-board-staging',
    'pnpm exec wrangler r2 bucket create agi-board-images-staging',
    'sh scripts/upload-backgrounds.sh --remote --env staging',
  ])
    assert.equal(d(checkBash(c, local)), 'ask', c);
  for (const c of [
    'pnpm exec wrangler deploy --dry-run --outdir dist-worker',
    'pnpm exec wrangler deploy --env staging --dry-run',
    'CI=true wrangler d1 migrations apply DB --local',
    'pnpm exec wrangler d1 execute DB --local --file prisma/seed.sql',
    'pnpm start:dev',
    'pnpm db:seed',
    'sh scripts/upload-backgrounds.sh --local',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('which checks count as run', () => {
  assert.deepEqual(checksInCommand('pnpm lint && pnpm typecheck'), ['lint', 'typecheck']);
  assert.deepEqual(checksInCommand('pnpm test:e2e 2>&1'), ['test:e2e']);
  assert.deepEqual(checksInCommand('pnpm test | tail -20'), []); // exit code is tail's
  assert.deepEqual(checksInCommand('pnpm test src/boards'), []); // partial run
  assert.deepEqual(checksInCommand('pnpm lint:fix'), []);
  assert.deepEqual(requiredChecks(['src/modules/boards/boards.service.ts']), ['lint', 'typecheck', 'test']);
  assert.deepEqual(requiredChecks(['prisma/schema/boards.prisma']), [
    'lint',
    'typecheck',
    'test',
    'test:e2e',
    'db:check',
  ]);
  assert.deepEqual(requiredChecks(['src/modules/boards/boards.controller.ts']), [
    'lint',
    'typecheck',
    'test',
    'test:e2e',
  ]);
});
