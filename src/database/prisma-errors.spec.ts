import { isD1UniqueConflict } from './prisma-errors';

describe('isD1UniqueConflict', () => {
  it.each([
    ['a D1 unique error', new Error('D1_ERROR: UNIQUE constraint failed: invites.workspace_id, invites.email'), true],
    ['another error', new Error('other'), false],
    ['a non-Error value', 'UNIQUE constraint failed', false],
  ])('%s', (_, err, expected) => {
    expect(isD1UniqueConflict(err)).toBe(expected);
  });
});
