import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { AuditAction } from '../generated/prisma/enums';

/** Raw SQL bypasses Prisma, which stores dates in this form. */
export const sqlDate = (date: Date) => date.toISOString().replace('Z', '+00:00');

/** RFC 9562 UUIDv7: ids written by raw SQL keep the `@default(uuid(7))` format and time order. */
export function uuidv7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AuditEntry {
  action: AuditAction;
  userId: string;
  /** The same `sqlDate` value as the change in the batch. */
  now: string;
  data?: Record<string, string>;
}

/**
 * An audit row for a user's action on their own account, for a `DB.batch`. It is inserted only when `guardSql` holds,
 * so a change that did not happen writes no row. `guardBinds` are bound first (`?1..?k`), so a guard string shared
 * with the batch's other statements works with the same bind array. The name is copied as it is at that moment.
 */
export function auditStatement(
  DB: D1Database,
  entry: AuditEntry,
  guardSql: string,
  guardBinds: unknown[],
): D1PreparedStatement {
  const k = guardBinds.length;
  return DB.prepare(
    `INSERT INTO audit_log_entries
       (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at)
     SELECT ?${k + 1}, NULL, u.id, u.full_name, ?${k + 2}, 'user', u.id, u.full_name, ?${k + 3}, ?${k + 4}, ?${k + 4}
     FROM users u WHERE u.id = ?${k + 5} AND (${guardSql})`,
  ).bind(...guardBinds, uuidv7(), entry.action, JSON.stringify(entry.data ?? {}), entry.now, entry.userId);
}
