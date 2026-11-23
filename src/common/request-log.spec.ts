import type { IncomingMessage } from 'node:http';
import { serializeRequest } from './request-log';

const req = (url: string, query: Record<string, string> = {}) =>
  ({ id: 'r1', method: 'GET', url, query, headers: {}, socket: {} }) as unknown as IncomingMessage;

describe('serializeRequest', () => {
  it('drops the OAuth code and state from the logged url and query', () => {
    const logged = JSON.stringify(
      serializeRequest(
        req('/api/v1/auth/google/callback?code=SECRET-CODE&state=SECRET-STATE', { code: 'SECRET-CODE' }),
      ),
    );
    expect(logged).not.toContain('SECRET-CODE');
    expect(logged).not.toContain('SECRET-STATE');
    expect(logged).toContain('/api/v1/auth/google/callback?redacted');
  });

  it('leaves other requests untouched', () => {
    const out = serializeRequest(req('/api/v1/health?x=1', { x: '1' }));
    expect(out.url).toBe('/api/v1/health?x=1');
    expect(out.query).toEqual({ x: '1' });
  });
});
