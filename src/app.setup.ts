import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { docsEnabled, type Env } from './config/env';

const API_PREFIX = 'api/v1';

/** HTTP setup shared by main.ts and the e2e tests. Guards, pipes and filters are in AppModule. */
export function setupApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('APP_ORIGIN', { infer: true }), credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (docsEnabled(config.get('NODE_ENV', { infer: true }), config.get('ENABLE_DOCS', { infer: true }))) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AGI Board API')
        .setVersion('v1')
        // The prefix is shown once as the server; "Try it out" still calls /api/v1/...
        .addServer(`/${API_PREFIX}`)
        .addCookieAuth(config.get('SESSION_COOKIE_NAME', { infer: true }))
        .build(),
      { ignoreGlobalPrefix: true },
    );
    // Nest's UI serves files from swagger-ui-dist, which a Worker cannot read; the JSON is at /api/docs-json.
    SwaggerModule.setup('api/docs', app, doc, { swaggerUiEnabled: false });
    // Swagger UI from a CDN instead. Overrides helmet's CSP for this page only, so it can load the CDN files.
    app.use('/api/docs', (_req: Request, res: Response) => {
      res.setHeader('Content-Security-Policy', SWAGGER_UI_CSP);
      res.type('html').send(SWAGGER_UI_HTML);
    });
  }
}

const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';
const SWAGGER_UI_CSP = [
  "default-src 'self'",
  `script-src 'unsafe-inline' ${SWAGGER_UI_CDN}/`,
  `style-src 'unsafe-inline' ${SWAGGER_UI_CDN}/`,
  "img-src 'self' data:",
].join('; ');
const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AGI Board API</title>
<link rel="stylesheet" href="${SWAGGER_UI_CDN}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER_UI_CDN}/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs-json', dom_id: '#swagger-ui', withCredentials: true });</script>
</body>
</html>`;
