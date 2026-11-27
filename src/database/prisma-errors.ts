import { Prisma } from '../generated/prisma/client';

export function isUniqueConflict(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Raw `DB.batch` statements fail with D1's own error, not Prisma's P2002. */
export function isD1UniqueConflict(err: unknown) {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}
