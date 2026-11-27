-- Migration number: 0002 	 2026-11-27T08:20:28.119Z
-- specs/6 (UI decisions #376, #377): every board has one of the 10 preset colors, shown when no image is set.
-- Hand-written: `pnpm db:diff` proposes a full rebuild of "boards" (drops the manual CHECKs and the
-- idx_boards_workspace_open index, and risks cascades on D1). ADD COLUMN gives the same column with no rebuild.

-- AlterTable
ALTER TABLE "boards" ADD COLUMN "background_color" TEXT NOT NULL DEFAULT '#0d9488'
    -- manual
    CONSTRAINT "boards_background_color_check" CHECK (background_color IN ('#0d9488', '#3b82d6', '#7fb8e6', '#8b5fd0', '#d64545', '#e8832b', '#e0b320', '#2e9e5b', '#6b7a90', '#3a4658'));

-- manual: backfill existing boards with a random preset color (AC 9.4); same palette as src/modules/boards/board-colors.ts.
UPDATE "boards" SET "background_color" = CASE abs(random() % 10)
    WHEN 0 THEN '#0d9488' WHEN 1 THEN '#3b82d6' WHEN 2 THEN '#7fb8e6' WHEN 3 THEN '#8b5fd0' WHEN 4 THEN '#d64545'
    WHEN 5 THEN '#e8832b' WHEN 6 THEN '#e0b320' WHEN 7 THEN '#2e9e5b' WHEN 8 THEN '#6b7a90' ELSE '#3a4658'
END;
