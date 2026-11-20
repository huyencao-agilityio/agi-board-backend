import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';

/** HTTP setup shared by main.ts and the e2e tests. Guards, pipes and filters are in AppModule. */
export function setupApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('APP_ORIGIN', { infer: true }), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AGI Board API')
        .setVersion('v1')
        .addCookieAuth(config.get('SESSION_COOKIE_NAME', { infer: true }))
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
}
