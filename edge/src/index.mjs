// Worker entry. wrangler runs `nest build` first (see wrangler.jsonc "build"): esbuild, which wrangler
// bundles with, cannot emit the decorator metadata Nest's DI needs. Express runs on the Workers node:http server.
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { Logger } from '@nestjs/common';
import { setBindings } from '../../dist/cloudflare.js';
import { createApp } from '../../dist/main.js';

// Internal to the Worker; clients use the host wrangler prints ("Ready on ...") or the Worker domain.
const PORT = 3000;

setBindings(env);
const app = await createApp();
await app.listen(PORT);

// The Worker cannot know its public host, so only paths are logged.
Logger.log('API server started at: <host>/api/v1', 'Bootstrap');
if (env.NODE_ENV !== 'production') {
  Logger.log('API docs (Swagger UI) at: <host>/api/docs', 'Bootstrap'); // same rule as setupApp
}

export default httpServerHandler({ port: PORT });
