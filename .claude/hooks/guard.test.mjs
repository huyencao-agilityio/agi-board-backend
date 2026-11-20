// Run: node --test .claude/hooks/guard.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBash, checkFile, checksInCommand, classifyDbUrl, requiredChecks, validateMigration } from './guard.mjs';

const d = (r) => r?.decision ?? 'allow';
const tracked = (p) => p.startsWith('prisma/migrations/20261120074124_init');
const local = {
  dotenv: { DATABASE_URL: 'postgresql://agi:agi@localhost:5432/agi_board' },
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
    "sed -i 's/a/b/' prisma/migrations/20261120074124_init/migration.sql",
  ])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  for (const c of [
    'cat .env.example',
    'cat prisma/migrations/20261120074124_init/migration.sql 2>&1',
    'rm -rf dist',
    'node -e "process.env.X"',
    'rm prisma/migrations/20261201000000_new/migration.sql',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('database safety', () => {
  assert.equal(classifyDbUrl('postgresql://a@localhost/agi_board'), 'local');
  assert.equal(classifyDbUrl('postgresql://a@localhost/agi_board_test'), 'test');
  assert.equal(classifyDbUrl('postgresql://a@db.staging.example.com/agi'), 'staging');
  assert.equal(classifyDbUrl('postgresql://a@prod-db.example.com/agi'), 'production');
  assert.equal(classifyDbUrl('postgresql://a@10.0.0.5/agi'), 'remote');
  assert.equal(classifyDbUrl('postgresql://a@localhost/agi', 'production'), 'production');

  for (const c of [
    'pnpm db:reset',
    'pnpm prisma migrate reset',
    'pnpm prisma db push',
    'DATABASE_URL=postgresql://u@prod.example.com/agi pnpm db:migrate',
    "psql postgresql://u@10.0.0.5/agi -c 'select 1'",
  ])
    assert.equal(d(checkBash(c, local)), 'deny', c);
  assert.equal(
    d(checkBash('pnpm db:migrate', { ...local, dotenv: { DATABASE_URL: 'postgresql://u@rds.amazonaws.com/agi' } })),
    'deny',
  );
  assert.equal(
    d(checkBash('pnpm db:migrate', { ...local, dotenv: { ...local.dotenv, NODE_ENV: 'production' } })),
    'deny',
  );
  assert.equal(d(checkBash('DATABASE_URL=postgresql://u@db.staging.x/agi pnpm db:seed', local)), 'ask');
  for (const c of [
    'psql -h localhost -U agi -d agi_board -c "DROP TABLE cards"',
    'psql -d agi_board -c "TRUNCATE users"',
    'docker compose down -v',
    'pnpm prisma migrate resolve --applied x',
  ])
    assert.equal(d(checkBash(c, local)), 'ask', c);
  for (const c of [
    'pnpm db:up',
    'pnpm db:migrate',
    'pnpm db:migrate:dev',
    'pnpm db:migrate:new add_x',
    'pnpm db:seed',
    'pnpm db:check',
    'pnpm test:e2e',
    'psql -d agi_board -c "select count(*) from users"',
    'docker compose down',
  ])
    assert.equal(d(checkBash(c, local)), 'allow', c);
});

test('file protection', () => {
  const ctx = { isTracked: tracked };
  for (const p of [
    '.env',
    '.env.production',
    'prisma/migrations/migration_lock.toml',
    'prisma/migrations/20261120074124_init/migration.sql',
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
    'prisma/migrations/20261201000000_add_x/migration.sql',
    '../agi-board-frontend/.env',
  ])
    assert.equal(d(checkFile(p, ctx)), 'allow', p);
});

test('migration validation', () => {
  const manual = new Set(['uq_cards_board_number']);
  const ok = validateMigration(
    'prisma/migrations/20261201000000_add_x/migration.sql',
    'ALTER TABLE "cards" ADD COLUMN "x" TEXT;',
    manual,
  );
  assert.deepEqual(ok, { errors: [], warnings: [] });
  const bad = validateMigration(
    'prisma/migrations/my_migration/migration.sql',
    'ALTER TABLE "cards" DROP CONSTRAINT "uq_cards_board_number";\nDROP TABLE "x";',
    manual,
  );
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.warnings.length, 2);
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
