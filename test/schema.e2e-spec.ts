import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Prisma cannot express these objects; they are hand-written in the init migration.
 * This test fails if a later migration drops one of them (see prisma/schema/schema.prisma).
 */
const MANUAL_CHECKS = [
  'activities_check',
  'attachments_size_bytes_check',
  'boards_check',
  'boards_name_check',
  'card_links_check',
  'cards_check',
  'cards_check1',
  'cards_check2',
  'cards_reminder_offset_minutes_check',
  'cards_title_check',
  'checklist_items_text_check',
  'checklists_title_check',
  'comments_body_check',
  'email_verification_codes_failed_attempts_check',
  'invites_email_check',
  'label_colors_hex_check',
  'lists_name_check',
  'user_sessions_check',
  'users_check',
  'users_check1',
  'users_email_check',
  'users_full_name_check',
  'workspaces_name_check',
];
const MANUAL_INDEXES = [
  'idx_users_full_name',
  'idx_users_search_trgm',
  'idx_boards_workspace_open',
  'idx_cards_search_trgm',
  'uq_card_links_pair',
];

describe('manual schema objects (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  afterAll(() => prisma.$disconnect());

  it('keeps every CHECK constraint', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    expect(rows.map((r) => r.conname)).toEqual(expect.arrayContaining(MANUAL_CHECKS));
  });

  it('keeps every expression index', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    expect(rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(MANUAL_INDEXES));
  });

  it('keeps NULLS NOT DISTINCT on pending invites', async () => {
    const [row] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_invites_pending_target'`;
    expect(row.indexdef).toContain('NULLS NOT DISTINCT');
  });

  it('keeps the card number constraint deferrable', async () => {
    const [row] = await prisma.$queryRaw<{ condeferred: boolean }[]>`
      SELECT condeferred FROM pg_constraint WHERE conname = 'uq_cards_board_number'`;
    expect(row.condeferred).toBe(true);
  });
});
