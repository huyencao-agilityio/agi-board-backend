/**
 * Seeds the fixed system catalogs. Safe to re-run: every row is an upsert by its key.
 * Values come from docs/database/seed.sql and are placeholders (agreed 2026-11-20):
 * change names, colors and paths freely, but never rename a key once boards or labels use it.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// 10 hues x 3 shades. New boards get the normal shade of the first 6 hues as default labels.
const LABEL_COLORS: [id: string, name: string, hex: string][] = [
  ['green_light', 'Light green', '#BAF3DB'],
  ['green', 'Green', '#4BCE97'],
  ['green_dark', 'Dark green', '#1F845A'],
  ['yellow_light', 'Light yellow', '#F8E6A0'],
  ['yellow', 'Yellow', '#F5CD47'],
  ['yellow_dark', 'Dark yellow', '#946F00'],
  ['orange_light', 'Light orange', '#FEDEC8'],
  ['orange', 'Orange', '#FEA362'],
  ['orange_dark', 'Dark orange', '#C25100'],
  ['red_light', 'Light red', '#FFD5D2'],
  ['red', 'Red', '#F87168'],
  ['red_dark', 'Dark red', '#C9372C'],
  ['purple_light', 'Light purple', '#DFD8FD'],
  ['purple', 'Purple', '#9F8FEF'],
  ['purple_dark', 'Dark purple', '#6E5DC6'],
  ['blue_light', 'Light blue', '#CCE0FF'],
  ['blue', 'Blue', '#579DFF'],
  ['blue_dark', 'Dark blue', '#0C66E4'],
  ['sky_light', 'Light sky', '#C6EDFB'],
  ['sky', 'Sky', '#6CC3E0'],
  ['sky_dark', 'Dark sky', '#227D9B'],
  ['lime_light', 'Light lime', '#D3F1A7'],
  ['lime', 'Lime', '#94C748'],
  ['lime_dark', 'Dark lime', '#5B7F24'],
  ['pink_light', 'Light pink', '#FDD0EC'],
  ['pink', 'Pink', '#E774BB'],
  ['pink_dark', 'Dark pink', '#AE4787'],
  ['gray_light', 'Light gray', '#DCDFE4'],
  ['gray', 'Gray', '#8590A2'],
  ['gray_dark', 'Dark gray', '#626F86'],
];

// Image files ship with the system in object storage.
const BOARD_BACKGROUNDS: [id: string, name: string][] = [
  ['mountains', 'Mountains'],
  ['ocean', 'Ocean'],
  ['forest', 'Forest'],
  ['desert', 'Desert'],
  ['city', 'City'],
  ['aurora', 'Aurora'],
  ['lake', 'Lake'],
  ['field', 'Field'],
  ['snow', 'Snow'],
  ['abstract', 'Abstract'],
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await prisma.$transaction([
      ...LABEL_COLORS.map(([id, name, hex], i) => {
        const data = { name, hex, sortOrder: i + 1 };
        return prisma.labelColor.upsert({ where: { id }, create: { id, ...data }, update: data });
      }),
      ...BOARD_BACKGROUNDS.map(([id, name], i) => {
        const data = {
          name,
          imageObjectKey: `system/backgrounds/${id}.jpg`,
          thumbnailObjectKey: `system/backgrounds/thumbs/${id}.jpg`,
          sortOrder: i + 1,
        };
        return prisma.boardBackground.upsert({ where: { id }, create: { id, ...data }, update: data });
      }),
    ]);
    console.log(`Seeded ${LABEL_COLORS.length} label colors, ${BOARD_BACKGROUNDS.length} board backgrounds.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
