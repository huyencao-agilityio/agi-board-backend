/** What a sign-in result needs. Never holds the password hash. */
export const signedInUserSelect = {
  id: true,
  email: true,
  fullName: true,
  systemRole: true,
  emailVerifiedAt: true,
  avatarObjectKey: true,
} as const;

/** For flows that check or replace the password. */
export const passwordUserSelect = { ...signedInUserSelect, deactivatedAt: true, passwordHash: true } as const;
