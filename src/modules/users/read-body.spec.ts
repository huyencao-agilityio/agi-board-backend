import { PayloadTooLargeException } from '@nestjs/common';
import { readBody } from './read-body';

/** Yields `count` chunks of `size` bytes and records how many were pulled. */
function chunks(count: number, size: number) {
  const state = { pulled: 0 };
  async function* gen() {
    for (let i = 0; i < count; i++) {
      await Promise.resolve();
      state.pulled++;
      yield new Uint8Array(size).fill(i);
    }
  }
  return { stream: gen(), state };
}

describe('readBody', () => {
  it('concatenates a body under the limit', async () => {
    const { stream } = chunks(3, 4);
    const body = await readBody(stream, 100);
    expect(body).toHaveLength(12);
    expect([...body.subarray(4, 8)]).toEqual([1, 1, 1, 1]);
  });

  it('accepts a body of exactly the limit', async () => {
    const { stream } = chunks(2, 5);
    await expect(readBody(stream, 10)).resolves.toHaveLength(10);
  });

  it('stops with 413 at limit + 1 without reading the rest', async () => {
    const { stream, state } = chunks(10, 5);
    await expect(readBody(stream, 9)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(state.pulled).toBe(2);
  });
});
