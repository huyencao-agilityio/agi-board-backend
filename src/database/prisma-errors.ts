import { Prisma } from '../generated/prisma/client';

export function isUniqueConflict(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
