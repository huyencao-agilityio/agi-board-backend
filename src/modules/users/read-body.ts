import { PayloadTooLargeException } from '@nestjs/common';
import { AVATAR_MAX_BYTES } from './image-type';

/** Room for the multipart boundary and part headers around a file of AVATAR_MAX_BYTES (specs/22 research D2). */
export const AVATAR_BODY_LIMIT = AVATAR_MAX_BYTES + 64 * 1024;

export const payloadTooLarge = () =>
  new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'The file is larger than 5 MB.' });

/**
 * Reads a request body, stopping with 413 as soon as it passes `limit`, so an oversized upload is never held whole
 * in memory (a Worker has ~128 MB).
 */
export async function readBody(
  stream: AsyncIterable<Uint8Array | string>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += bytes.length;
    if (total > limit) throw payloadTooLarge();
    chunks.push(bytes);
  }
  // A plain ArrayBuffer-backed copy: what the Web `Response` constructor accepts.
  const body = new Uint8Array(total);
  let offset = 0;
  for (const bytes of chunks) {
    body.set(bytes, offset);
    offset += bytes.length;
  }
  return body;
}
