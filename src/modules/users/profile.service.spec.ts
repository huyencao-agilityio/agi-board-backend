import type { PrismaService } from '../../database/prisma.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  const row = {
    id: 'u1',
    email: 'a@example.com',
    fullName: 'A',
    avatarObjectKey: null,
    passwordHash: '$pbkdf2-sha256$i=1$x$y',
    googleSubject: null,
  };

  it('maps flags and never returns the hash or Google subject', async () => {
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(row) } };
    const profile = await new ProfileService(prisma as unknown as PrismaService).getProfile('u1');
    expect(profile).toEqual({
      id: 'u1',
      email: 'a@example.com',
      fullName: 'A',
      avatarUrl: null,
      hasPassword: true,
      googleLinked: false,
    });
  });

  it('marks a Google-only account', async () => {
    const google = { ...row, passwordHash: null, googleSubject: 'g-1' };
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(google) } };
    const profile = await new ProfileService(prisma as unknown as PrismaService).getProfile('u1');
    expect(profile).toMatchObject({ hasPassword: false, googleLinked: true });
  });
});
