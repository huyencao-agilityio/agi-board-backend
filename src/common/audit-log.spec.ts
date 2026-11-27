import { sqlDate, uuidv7 } from './audit-log';

describe('uuidv7', () => {
  it('is a version 7, RFC variant uuid', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('starts with the millisecond timestamp, so ids sort by time', () => {
    const at = Date.UTC(2026, 10, 27, 1, 2, 3, 4);
    expect(uuidv7(at).replace('-', '').slice(0, 12)).toBe(at.toString(16).padStart(12, '0'));
    expect(uuidv7(at) < uuidv7(at + 2)).toBe(true);
  });

  it('is unique', () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7(0))).size).toBe(1000);
  });
});

describe('sqlDate', () => {
  it('writes the form Prisma stores', () => {
    expect(sqlDate(new Date('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02T03:04:05.006+00:00');
  });
});
