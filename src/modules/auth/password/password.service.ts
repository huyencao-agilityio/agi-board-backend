import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../../../config/env';

const ALGORITHM = 'pbkdf2-sha256';
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const FORMAT = /^\$pbkdf2-sha256\$i=(\d+)\$([^$]+)\$([^$]+)$/;

/**
 * PBKDF2-SHA256 through WebCrypto (native speed). Chosen over argon2id because the Workers free plan allows
 * ~10 ms CPU per request: see specs/4/research.md R1. The hash string carries algorithm and iterations, so a
 * later move to argon2id (paid plan) can verify old hashes and rehash at sign-in.
 */
@Injectable()
export class PasswordService {
  private readonly iterations: number;

  constructor(config: ConfigService<Env, true>) {
    this.iterations = config.get('PASSWORD_PBKDF2_ITERATIONS', { infer: true });
  }

  private async derive(password: string, salt: Uint8Array, iterations: number, bytes: number) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    // Copy the salt: WebCrypto wants an ArrayBuffer-backed view, and a Buffer may sit on a shared pool.
    const params = { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations };
    const bits = await crypto.subtle.deriveBits(params, key, bytes * 8);
    return Buffer.from(bits);
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const key = await this.derive(password, salt, this.iterations, HASH_BYTES);
    return `$${ALGORITHM}$i=${this.iterations}$${Buffer.from(salt).toString('base64')}$${key.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const match = FORMAT.exec(stored);
    if (!match) return false;
    const [, iterations, salt, hash] = match;
    const expected = Buffer.from(hash, 'base64');
    const actual = await this.derive(password, Buffer.from(salt, 'base64'), Number(iterations), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** For an unknown email or a Google-only account: same cost as a real check, always false. */
  async verifyDummy(password: string): Promise<false> {
    await this.derive(password, new Uint8Array(SALT_BYTES), this.iterations, HASH_BYTES);
    return false;
  }
}
