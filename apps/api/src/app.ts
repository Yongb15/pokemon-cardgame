import 'reflect-metadata'
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { json } from 'express'
import { AuthController, SERVICES, TestAuthController, type Services } from './auth/auth.controller.js'
import { originCheck, RateLimiter } from './auth/guards.js'
import { googleProvider, type Provider } from './auth/providers.js'
import { Sessions } from './auth/sessions.js'
import type { AccountStore } from './auth/store.js'
import type { TestProvider } from './auth/test-provider.js'
import type { Config } from './config.js'
import { ErrorFilter } from './errors.js'
import { HealthController } from './health.controller.js'
import { proxyAuth, securityHeaders } from './http.js'

@Module({})
class AppModule {
  static with(services: Services): DynamicModule {
    return {
      module: AppModule,
      // The test sign-in's routes don't exist at all unless it is on
      controllers: [HealthController, AuthController, ...(services.testProvider ? [TestAuthController] : [])],
      providers: [{ provide: SERVICES, useValue: services }],
    }
  }
}

export interface Dependencies {
  store?: AccountStore | null
  testProvider?: TestProvider | null
  /** Tests swap Google's endpoints for a local fake */
  google?: Provider | null
}

/** Wires the providers that the configuration enables */
export function buildServices(config: Config, deps: Dependencies = {}): Services {
  const store = deps.store ?? null
  const providers = new Map<string, Provider>()
  const google = deps.google ?? (config.googleReady ? googleProvider(config) : null)
  if (google && store) providers.set('google', google)
  const testProvider = config.AUTH_TEST_PROVIDER === '1' && store ? (deps.testProvider ?? null) : null
  if (testProvider) providers.set('test', testProvider)
  return {
    config,
    store,
    sessions: store ? new Sessions(store) : null,
    providers,
    testProvider,
    cookieKey: config.OAUTH_COOKIE_KEY ? Buffer.from(config.OAUTH_COOKIE_KEY, 'base64url') : null,
  }
}

/** The API app with its guards; main.ts listens, tests call it directly */
export async function createApp(config: Config, deps: Dependencies = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.with(buildServices(config, deps)), {
    bodyParser: false,
    logger: config.APP_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  })
  app.disable('x-powered-by')
  // Cloud Run sits behind Google's front end: one hop to trust for req.protocol
  app.set('trust proxy', 1)
  app.use(securityHeaders)
  app.use(proxyAuth(config))
  app.use(originCheck(config))
  // Sign-in start/callback: 30 a minute per visitor
  app.use('/api/v1/auth', new RateLimiter(30, 60_000).middleware())
  // Small bodies only (the biggest is a deck import)
  app.use(json({ limit: '64kb' }))
  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new ErrorFilter())
  app.enableShutdownHooks()
  return app
}
