import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PasswordService } from './password.service';

const withIterations = (n: number) => new PasswordService({ get: () => n } as unknown as ConfigService<Env, true>);

describe('PasswordService', () => {
  const service = withIterations(1000);

  it('hashes to a self-describing string and verifies the same password', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$pbkdf2-sha256\$i=1000\$[^$]+\$[^$]+$/);
    expect(await service.verify('correct horse battery staple', hash)).toBe(true);
  });

  it('uses a fresh salt for every hash', async () => {
    expect(await service.hash('same')).not.toBe(await service.hash('same'));
  });

  it('rejects a wrong password and a malformed hash', async () => {
    const hash = await service.hash('right');
    expect(await service.verify('wrong', hash)).toBe(false);
    expect(await service.verify('right', 'not-a-hash')).toBe(false);
  });

  it('verifies a hash made with a different iteration count (the count lives in the string)', async () => {
    const old = await withIterations(500).hash('right');
    expect(await service.verify('right', old)).toBe(true);
  });

  it('verifyDummy always returns false', async () => {
    expect(await service.verifyDummy('anything')).toBe(false);
  });
});
