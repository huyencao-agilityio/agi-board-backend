import { detectImageType } from './image-type';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('detectImageType', () => {
  it.each([
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'image/jpeg'],
    ['PNG', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
    ['GIF87a', bytes('GIF87a', [0]), 'image/gif'],
    ['GIF89a', bytes('GIF89a', [0]), 'image/gif'],
    ['WebP', bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '), 'image/webp'],
    ['AVI in RIFF', bytes('RIFF', [1, 2, 3, 4], 'AVI LIST'), null],
    ['text', bytes('hello world'), null],
    ['PDF', bytes('%PDF-1.7'), null],
    ['empty', bytes(), null],
    ['2 bytes of JPEG', bytes([0xff, 0xd8]), null],
  ])('%s', (_name, input, expected) => {
    expect(detectImageType(input)).toBe(expected);
  });
});
