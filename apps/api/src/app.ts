import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { json } from 'express'
import type { Config } from './config.js'
import { ErrorFilter } from './errors.js'
import { HealthController } from './health.controller.js'
import { proxyAuth, securityHeaders } from './http.js'

@Module({ controllers: [HealthController] })
class AppModule {}

/** The API app with its guards; main.ts listens, tests call it directly */
export async function createApp(config: Config): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.APP_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  })
  app.disable('x-powered-by')
  // Cloud Run sits behind Google's front end: one hop to trust for req.protocol
  app.set('trust proxy', 1)
  app.use(securityHeaders)
  app.use(proxyAuth(config))
  // Small bodies only (the biggest is a deck import)
  app.use(json({ limit: '64kb' }))
  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new ErrorFilter())
  app.enableShutdownHooks()
  return app
}
