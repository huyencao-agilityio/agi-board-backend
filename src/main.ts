import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  setupApp(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const base = `http://localhost:${port}`;
  logger.log(`Server running at ${base}/api/v1`, 'Bootstrap');
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    logger.log(`Swagger docs at ${base}/api/docs`, 'Bootstrap');
  }
}
void bootstrap();
