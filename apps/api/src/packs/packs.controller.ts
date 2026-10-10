// Card packs and the collection (docs/auction/packs.md). The odds are public; everything else needs
// a session, and writes are limited per user and checked by origin like every other write.
//   GET  /api/v1/packs                         → { price, size, sets: [{ id, nameKo, releaseDate, cards, odds }] }
//   POST /api/v1/me/packs { setId, idemKey }   → { kind: opened|repeat, pack, points }   422 short of points
//   GET  /api/v1/me/packs/latest               → { pack | null } (the caller's own; no id parameter)
//   GET  /api/v1/me/collection?set=&page=      → { cards: [{ cardId, count, test, newest }], more }
//   GET  /api/v1/me/collection/summary         → { cards, distinct, sets: [{ id, owned, total }] }
// Preview only, test accounts only (Security T-1/T-2, K-3):
//   POST /api/v1/test/cards { cardId, count }  → 204 (pool card ids only, source 'test')
//   GET  /api/v1/test/pack-check               → { mine, all } (cards[] vs copies per pack: counts)
//   POST /api/v1/me/packs also takes { seed } then, and marks the pack seeded

import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { RateLimiter } from '../auth/guards.js'
import { UserRoutes } from '../data/data.controller.js'
import { PublicError } from '../errors.js'
import { PACK_PRICE, PACK_SETS, PACK_SIZE, packOdds, packSet, POOL_IDS, seededRng } from './odds.js'
import type { OpenedPack } from './store.js'

const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)
const IDEM = /^[A-Za-z0-9_-]{8,64}$/
const SET_IDS = PACK_SETS.map((s) => s.id) as [string, ...string[]]

const OpenBody = z.strictObject({ setId: z.enum(SET_IDS), idemKey: z.string().regex(IDEM) })
/** With the test gate on, a seed may come along (Security K-1: never in production) */
const OpenBodyWithSeed = OpenBody.extend({ seed: z.number().int().min(0).max(2 ** 32 - 1).optional() }).strict()

/** Ten packs a minute per user, on top of the general write limit */
const packLimit = new RateLimiter(10, 60_000)

const packView = (p: OpenedPack) => ({ id: p.id, setId: p.setId, cards: p.cards, createdAt: p.createdAt.toISOString() })

abstract class PackRoutes extends UserRoutes {
  protected get packs() {
    if (!this.services.packs || !this.services.points) throw new PublicError('잠시 후 다시 시도해 주세요.', 503)
    return this.services.packs
  }

  /** A signed-in account whose only sign-in method is the test provider (Security T-2) */
  protected async testOnly(userId: string) {
    const providers = await this.services.store!.providersOf(userId)
    if (!providers.length || providers.some((p) => p !== 'test')) throw new PublicError('테스트 계정만 쓸 수 있어요.', 403)
  }
}

@Controller('packs')
export class PacksCatalogController {
  // Static odds: cacheable at the edge (qa Info)
  @Get()
  catalog(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')
    return {
      price: PACK_PRICE,
      size: PACK_SIZE,
      sets: PACK_SETS.map((s) => ({ id: s.id, nameKo: s.nameKo, releaseDate: s.releaseDate, cards: Object.values(s.tiers).flat().length, odds: packOdds(s) })),
    }
  }
}

@Controller('me')
export class PacksController extends PackRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Post('packs')
  @HttpCode(200)
  async open(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const testing = !!this.services.testProvider
    const parsed = (testing ? OpenBodyWithSeed : OpenBody).safeParse(body)
    if (!parsed.success) throw badRequest()
    const seed = 'seed' in parsed.data ? (parsed.data.seed as number | undefined) : undefined
    if (seed !== undefined) await this.testOnly(user.id)
    // A retry of a pack already opened gets that pack, even at the rate limit (qa B7-3)
    const prior = await this.packs.prior(user.id, parsed.data.idemKey)
    if (prior) return { kind: 'repeat', pack: packView(prior), points: await this.services.points!.summary(user.id) }
    if (!packLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('카드팩은 1분에 10번까지 열 수 있어요.', 429)
    }
    const result = await this.packs.open(user.id, parsed.data.setId, parsed.data.idemKey, seed === undefined ? undefined : seededRng(seed), seed !== undefined)
    if (result.kind === 'insufficient') {
      throw new PublicError(`포인트가 ${PACK_PRICE.toLocaleString('ko-KR')}P 필요해요 (${(PACK_PRICE - result.available).toLocaleString('ko-KR')}P 부족해요).`, 422)
    }
    return { kind: result.kind, pack: packView(result.pack), points: await this.services.points!.summary(user.id) }
  }

  @Get('packs/latest')
  async latest(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw badRequest()
    const user = await this.user(req, res)
    const pack = await this.packs.latest(user.id)
    return { pack: pack ? packView(pack) : null }
  }

  @Get('collection')
  async collection(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    // Strict: only `set` (a pack set) and `page` (0..999) (Security 7b)
    if (Object.keys(query).some((k) => k !== 'set' && k !== 'page')) throw badRequest()
    const set = query.set
    if (set !== undefined && (typeof set !== 'string' || !packSet(set))) throw badRequest()
    const page = query.page === undefined ? 0 : typeof query.page === 'string' && /^\d{1,3}$/.test(query.page) ? Number(query.page) : -1
    if (page < 0) throw badRequest()
    const user = await this.user(req, res)
    await this.services.auctions?.settleExpired(20, user.id)
    const { rows, more } = await this.packs.collection(user.id, (set as string | undefined) ?? null, page)
    return { cards: rows.map((r) => ({ cardId: r.cardId, count: r.count, test: r.test, listed: r.listed, newest: r.newest.toISOString() })), more }
  }

  @Get('collection/summary')
  async summary(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw badRequest()
    const user = await this.user(req, res)
    return this.packs.summary(user.id)
  }
}

const TestCards = z.strictObject({ cardId: z.string().refine((id) => POOL_IDS.has(id)), count: z.number().int().min(1).max(20) })

/** Registered only with the test sign-in (preview + dev database) */
@Controller('test')
export class TestPacksController extends PackRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Post('cards')
  @HttpCode(204)
  async cards(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    await this.testOnly(user.id)
    const parsed = TestCards.safeParse(body)
    if (!parsed.success) throw badRequest()
    await this.packs.addTestCards(user.id, parsed.data.cardId, parsed.data.count)
  }

  @Get('pack-check')
  async packCheck(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    await this.testOnly(user.id)
    return this.packs.packCheck(user.id)
  }
}
