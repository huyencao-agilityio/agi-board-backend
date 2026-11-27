import { randomInt } from 'node:crypto';

/** The 10 preset board colors (UI decision #377); the DB CHECK `boards_background_color_check` lists the same values. */
export const BOARD_COLORS = [
  '#0d9488',
  '#3b82d6',
  '#7fb8e6',
  '#8b5fd0',
  '#d64545',
  '#e8832b',
  '#e0b320',
  '#2e9e5b',
  '#6b7a90',
  '#3a4658',
] as const;

/** The default color of a new board: picked at random once, stored, never re-randomised (decision #376). */
export const randomBoardColor = (): string => BOARD_COLORS[randomInt(BOARD_COLORS.length)];
