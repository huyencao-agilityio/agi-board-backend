import { avatarUrl, avatarVersion } from './avatar-url';

describe('avatarUrl', () => {
  it('is null without a key', () => expect(avatarUrl(null)).toBeNull());
  it('uses the key uuid as version', () => {
    expect(avatarVersion('avatars/u1/abc')).toBe('abc');
    expect(avatarUrl('avatars/u1/abc')).toBe('/api/v1/users/me/avatar?v=abc');
  });
});
