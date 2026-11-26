/** The random uuid that ends each upload's key: unique system-wide, never a per-user counter (specs/22 D4). */
export const avatarVersion = (key: string) => key.split('/').pop()!;

/**
 * Where the signed-in user's photo is served, or `null` for the initials avatar. A new photo gets a new URL, so the
 * image can be cached for good; `GET /users/me/avatar` serves only this exact `v`.
 */
export function avatarUrl(key: string | null): string | null {
  return key ? `/api/v1/users/me/avatar?v=${avatarVersion(key)}` : null;
}
