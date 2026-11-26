import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const res = {
    status: jest.fn<unknown, [number]>().mockReturnThis(),
    json: jest.fn<unknown, [{ error: { code: string } }]>(),
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter();
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return {
    status: res.status.mock.calls[0][0],
    body: res.json.mock.calls[0][0],
  };
}

describe('AllExceptionsFilter: body-parser errors', () => {
  it('maps an exposed 4xx parser error to its status', () => {
    const { status, body } = run(
      Object.assign(new Error('request entity too large'), {
        expose: true,
        status: 413,
        type: 'entity.too.large',
      }),
    );
    expect(status).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('keeps 500 when the error is not exposed', () => {
    expect(run(Object.assign(new Error('x'), { expose: false, status: 413 })).status).toBe(500);
  });

  it('keeps 500 for a plain error', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
