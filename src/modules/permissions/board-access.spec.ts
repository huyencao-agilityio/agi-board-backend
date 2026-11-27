import { BoardAccessFacts, canCreateBoard, canViewBoard } from './board-access';

// Add one row per rule as features land; keep the table the readable spec of who can do what.
describe('canViewBoard', () => {
  const cases: [string, BoardAccessFacts, boolean][] = [
    ['workspace admin, private board', { workspaceRole: 'admin', boardRole: null, visibility: 'private' }, true],
    ['workspace member, workspace board', { workspaceRole: 'member', boardRole: null, visibility: 'workspace' }, true],
    [
      'workspace member, private board, not on it',
      { workspaceRole: 'member', boardRole: null, visibility: 'private' },
      false,
    ],
    [
      'workspace member, private board, on it',
      { workspaceRole: 'member', boardRole: 'member', visibility: 'private' },
      true,
    ],
    ['board-only member', { workspaceRole: null, boardRole: 'member', visibility: 'private' }, true],
    ['board-only admin', { workspaceRole: null, boardRole: 'admin', visibility: 'workspace' }, true],
    ['outsider, workspace board', { workspaceRole: null, boardRole: null, visibility: 'workspace' }, false],
  ];

  it.each(cases)('%s', (_, facts, expected) => {
    expect(canViewBoard(facts)).toBe(expected);
  });
});

describe('canCreateBoard', () => {
  const cases: [string, Pick<BoardAccessFacts, 'workspaceRole'>, boolean][] = [
    ['workspace admin', { workspaceRole: 'admin' }, true],
    ['workspace member', { workspaceRole: 'member' }, false],
    ['board-only member or outsider', { workspaceRole: null }, false],
  ];

  it.each(cases)('%s', (_, facts, expected) => {
    expect(canCreateBoard(facts)).toBe(expected);
  });
});
