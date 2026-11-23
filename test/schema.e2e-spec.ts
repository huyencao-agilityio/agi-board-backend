import { getBindings } from '../src/cloudflare';

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
  'idx_boards_workspace_open',
  'uq_card_links_pair',
  'uq_invites_pending_target_nulls',
];

describe('manual schema objects (e2e)', () => {
  async function schema() {
    const { results } = await getBindings()
      .DB.prepare('SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL')
      .all<{ name: string; sql: string }>();
    return results;
  }

  it('keeps every CHECK constraint', async () => {
    const sql = (await schema()).map((r) => r.sql).join('\n');
    for (const name of MANUAL_CHECKS) expect(sql).toContain(`CONSTRAINT "${name}" CHECK`);
  });

  it('keeps every expression index', async () => {
    const names = (await schema()).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(MANUAL_INDEXES));
  });
});
