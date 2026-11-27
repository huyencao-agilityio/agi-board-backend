import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARD_COLORS, randomBoardColor } from './board-colors';

describe('board colors', () => {
  it('has 10 distinct preset colors', () => {
    expect(new Set(BOARD_COLORS).size).toBe(10);
  });

  it('matches the palette in the DB CHECK', () => {
    const sql = readFileSync(join(__dirname, '../../../prisma/migrations/0002_board_background_color.sql'), 'utf8');
    const check = /CHECK \(background_color IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    expect(check.match(/#[0-9a-f]{6}/g)).toEqual([...BOARD_COLORS]);
  });

  it('picks only preset colors and reaches all of them', () => {
    const seen = new Set(Array.from({ length: 500 }, randomBoardColor));
    expect([...seen].every((c) => (BOARD_COLORS as readonly string[]).includes(c))).toBe(true);
    expect(seen.size).toBe(10);
  });
});
