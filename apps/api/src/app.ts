import 'reflect-metadata'
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { json } from 'express'
import { AuthController, SERVICES, TestAuthController, type Services } from './auth/auth.controller.js'
import { originCheck, RateLimiter, requireSessionCookie } from './auth/guards.js'
import { DecksController, FavoritesController, MeController } from './data/data.controller.js'
import { AuctionsPublicController, MyAuctionsController, TestAuctionsController } from './auctions/auctions.controller.js'
import type { AuctionsStore } from './auctions/store.js'
import { PacksCatalogController, PacksController, TestPacksController } from './packs/packs.controller.js'
import type { PacksStore } from './packs/store.js'
import { PointsController, TestDataController } from './points/points.controller.js'
import type { PointsStore } from './points/store.js'
import type { UserDataStore } from './data/store.js'
import { googleProvider, kakaoProvider, type Provider } from './auth/providers.js'
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
      controllers: [
        HealthController,
        AuthController,
        DecksController,
        FavoritesController,
        MeController,
        PointsController,
        PacksCatalogController,
        PacksController,
        AuctionsPublicController,
        MyAuctionsController,
        // Test-only routes exist only with the test sign-in (Security T-1)
        ...(services.testProvider ? [TestAuthController, TestDataController, TestPacksController, TestAuctionsController] : []),
      ],
      providers: [{ provide: SERVICES, useValue: services }],
    }
  }
}

export interface Dependencies {
  store?: AccountStore | null
  data?: UserDataStore | null
  points?: PointsStore | null
  packs?: PacksStore | null
  auctions?: AuctionsStore | null
  testProvider?: TestProvider | null
  /** Tests swap the real providers' endpoints for local fakes */
  google?: Provider | null
  kakao?: Provider | null
}

/** Wires the providers that the configuration enables */
export function buildServices(config: Config, deps: Dependencies = {}): Services {
  const store = deps.store ?? null
  const providers = new Map<string, Provider>()
  const google = deps.google ?? (config.googleReady ? googleProvider(config) : null)
  if (google && store) providers.set('google', google)
  const kakao = deps.kakao ?? (config.kakaoReady ? kakaoProvider(config) : null)
  if (kakao && store) providers.set('kakao', kakao)
  const testProvider = config.AUTH_TEST_PROVIDER === '1' && store ? (deps.testProvider ?? null) : null
  if (testProvider) providers.set('test', testProvider)
  return {
    config,
    store,
    sessions: store ? new Sessions(store) : null,
    providers,
    testProvider,
    cookieKey: config.OAUTH_COOKIE_KEY ? Buffer.from(config.OAUTH_COOKIE_KEY, 'base64url') : null,
    data: store ? (deps.data ?? null) : null,
    points: store ? (deps.points ?? null) : null,
    packs: store ? (deps.packs ?? null) : null,
    auctions: store ? (deps.auctions ?? null) : null,
    writeLimit: new RateLimiter(60, 60_000),
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
  // Small bodies only; a deck import (up to 100 decks of 60 cards) gets more room
  // Without a session cookie that bigger body isn't even read (Security S5-3)
  app.use('/api/v1/decks/import', requireSessionCookie, json({ limit: '256kb' }))
  app.use(json({ limit: '64kb' }))
  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new ErrorFilter())
  app.enableShutdownHooks()
  return app
}
