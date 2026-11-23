-- Seeds the fixed system catalogs. Safe to re-run: every row is an upsert by its key.
-- Run: pnpm db:seed (local) / wrangler d1 execute DB --remote --env <env> --file prisma/seed.sql (CI does this).
-- Values come from docs/database/seed.sql and are placeholders (agreed 2026-11-20):
-- change names, colors and paths freely, but never rename a key once boards or labels use it.

-- 10 hues x 3 shades. New boards get the normal shade of the first 6 hues as default labels.
INSERT INTO label_colors (id, name, hex, sort_order) VALUES
  ('green_light', 'Light green', '#BAF3DB', 1),
  ('green', 'Green', '#4BCE97', 2),
  ('green_dark', 'Dark green', '#1F845A', 3),
  ('yellow_light', 'Light yellow', '#F8E6A0', 4),
  ('yellow', 'Yellow', '#F5CD47', 5),
  ('yellow_dark', 'Dark yellow', '#946F00', 6),
  ('orange_light', 'Light orange', '#FEDEC8', 7),
  ('orange', 'Orange', '#FEA362', 8),
  ('orange_dark', 'Dark orange', '#C25100', 9),
  ('red_light', 'Light red', '#FFD5D2', 10),
  ('red', 'Red', '#F87168', 11),
  ('red_dark', 'Dark red', '#C9372C', 12),
  ('purple_light', 'Light purple', '#DFD8FD', 13),
  ('purple', 'Purple', '#9F8FEF', 14),
  ('purple_dark', 'Dark purple', '#6E5DC6', 15),
  ('blue_light', 'Light blue', '#CCE0FF', 16),
  ('blue', 'Blue', '#579DFF', 17),
  ('blue_dark', 'Dark blue', '#0C66E4', 18),
  ('sky_light', 'Light sky', '#C6EDFB', 19),
  ('sky', 'Sky', '#6CC3E0', 20),
  ('sky_dark', 'Dark sky', '#227D9B', 21),
  ('lime_light', 'Light lime', '#D3F1A7', 22),
  ('lime', 'Lime', '#94C748', 23),
  ('lime_dark', 'Dark lime', '#5B7F24', 24),
  ('pink_light', 'Light pink', '#FDD0EC', 25),
  ('pink', 'Pink', '#E774BB', 26),
  ('pink_dark', 'Dark pink', '#AE4787', 27),
  ('gray_light', 'Light gray', '#DCDFE4', 28),
  ('gray', 'Gray', '#8590A2', 29),
  ('gray_dark', 'Dark gray', '#626F86', 30)
ON CONFLICT (id) DO UPDATE SET name = excluded.name, hex = excluded.hex, sort_order = excluded.sort_order,
  updated_at = CURRENT_TIMESTAMP;

-- Image files ship with the system in R2 (bucket bound as IMAGES).
INSERT INTO board_backgrounds (id, name, image_object_key, thumbnail_object_key, sort_order) VALUES
  ('mountains', 'Mountains', 'system/backgrounds/mountains.jpg', 'system/backgrounds/thumbs/mountains.jpg', 1),
  ('ocean', 'Ocean', 'system/backgrounds/ocean.jpg', 'system/backgrounds/thumbs/ocean.jpg', 2),
  ('forest', 'Forest', 'system/backgrounds/forest.jpg', 'system/backgrounds/thumbs/forest.jpg', 3),
  ('desert', 'Desert', 'system/backgrounds/desert.jpg', 'system/backgrounds/thumbs/desert.jpg', 4),
  ('city', 'City', 'system/backgrounds/city.jpg', 'system/backgrounds/thumbs/city.jpg', 5),
  ('aurora', 'Aurora', 'system/backgrounds/aurora.jpg', 'system/backgrounds/thumbs/aurora.jpg', 6),
  ('lake', 'Lake', 'system/backgrounds/lake.jpg', 'system/backgrounds/thumbs/lake.jpg', 7),
  ('field', 'Field', 'system/backgrounds/field.jpg', 'system/backgrounds/thumbs/field.jpg', 8),
  ('snow', 'Snow', 'system/backgrounds/snow.jpg', 'system/backgrounds/thumbs/snow.jpg', 9),
  ('abstract', 'Abstract', 'system/backgrounds/abstract.jpg', 'system/backgrounds/thumbs/abstract.jpg', 10)
ON CONFLICT (id) DO UPDATE SET name = excluded.name, image_object_key = excluded.image_object_key,
  thumbnail_object_key = excluded.thumbnail_object_key, sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP;
