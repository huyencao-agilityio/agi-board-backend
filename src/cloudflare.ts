import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

/** Worker bindings declared in wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  IMAGES: R2Bucket;
}

let current: Bindings | undefined;

/** Called before Nest starts: by the Worker entry (edge/src/index.mjs) and by the e2e setup. */
export function setBindings(bindings: Bindings) {
  current = bindings;
}

export function getBindings(): Bindings {
  if (!current) throw new Error('Cloudflare bindings are not set; start the app through the Worker entry.');
  return current;
}

let background: (task: Promise<unknown>) => void = () => {};

/** Called by the Worker entry with `waitUntil`, so a task outlives the response. Elsewhere the process keeps it alive. */
export function setBackgroundRunner(run: (task: Promise<unknown>) => void) {
  background = run;
}

/** Runs a task the response must not wait for. The task handles its own errors. */
export function runInBackground(task: Promise<unknown>) {
  background(task);
}
