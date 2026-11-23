import { getPlatformProxy } from 'wrangler';
import { setBindings, type Bindings } from '../../src/cloudflare';
import { E2E_STATE_DIR } from './state';

// Real local D1/R2 bindings from wrangler.jsonc, the same ones `wrangler dev` uses.
let dispose: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Bindings>({
    persist: { path: `${E2E_STATE_DIR}/v3` }, // wrangler --persist-to adds the v3/ level itself
    envFiles: ['test/setup/e2e.env'],
  });
  setBindings(proxy.env);
  dispose = proxy.dispose;
});

afterAll(() => dispose?.());
