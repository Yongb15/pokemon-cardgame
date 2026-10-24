// Card packs and the collection (docs/auction/packs.md). The odds are public; everything else needs
// a session, and writes are limited per user and checked by origin like every other write.
//   GET  /api/v1/packs                         → { price, size, sets: [{ id, nameKo, releaseDate, cards, odds }] }
//   POST /api/v1/me/packs { setId, idemKey }   → { kind: opened|repeat, pack, points }   422 short of points
//   GET  /api/v1/me/packs/latest               → { pack | null } (the caller's own; no id parameter)
//   GET  /api/v1/me/collection?set=&page=      → { cards: [{ cardId, count, test, newest }], more }
//   GET  /api/v1/me/collection/summary         → { cards, distinct, sets: [{ id, owned, total }], owned: [{ cardId, count }] }
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
import { BUNDLE_SIZE, CRAFT_FACTOR, EXCHANGE_VALUE, guaranteeOdds, GUARANTEE_SLOT, PACK_PRICE, PACK_SETS, PACK_SIZE, packOdds, packSet, POOL_IDS, seededRng } from './odds.js'
import { CRAFT_DAILY, EXCHANGE_DAILY_POINTS, EXCHANGE_MAX, type OpenedPack } from './store.js'

const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)
const IDEM = /^[A-Za-z0-9_-]{8,64}$/
const SET_IDS = PACK_SETS.map((s) => s.id) as [string, ...string[]]

/** count: 1 (the default) or 10 (docs/auction/exchange.md §1) */
const OpenBody = z.strictObject({ setId: z.enum(SET_IDS), idemKey: z.string().regex(IDEM), count: z.union([z.literal(1), z.literal(BUNDLE_SIZE)]).optional() })
const CARD_ID = /^[A-Za-z0-9_.!?-]{1,40}$/
const ExchangeBody = z.strictObject({ cardId: z.string().regex(CARD_ID), count: z.number().int().min(1).max(EXCHANGE_MAX), idemKey: z.string().regex(IDEM) })
const CraftBody = z.strictObject({ cardId: z.string().regex(CARD_ID), idemKey: z.string().regex(IDEM) })
/** Exchange and craft: twenty writes a minute per user, on top of the general write limit */
const cardLimit = new RateLimiter(20, 60_000)
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
  catalog(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    // No parameters at all: one URL is one edge cache entry (Security PK-1, the T-1 rule)
    if (Object.keys(query).length) throw badRequest()
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')
    return {
      price: PACK_PRICE,
      size: PACK_SIZE,
      // cardIds: the fixed pool behind the public odds, for "cards not collected yet" (v1.15.0 §4); draws stay here
      sets: PACK_SETS.map((s) => {
        const cardIds = [...new Set(Object.values(s.tiers).flat())].sort()
        // The 10-pack guarantee as data, from the weights the draw uses (Security X-8)
        return { id: s.id, nameKo: s.nameKo, releaseDate: s.releaseDate, cards: Object.values(s.tiers).flat().length, odds: packOdds(s), cardIds, guarantee: guaranteeOdds(s), tiers: s.tiers }
      }),
      bundle: { size: BUNDLE_SIZE, price: PACK_PRICE * BUNDLE_SIZE, guaranteeTiers: GUARANTEE_SLOT.map(([t, w]) => ({ tier: t, weight: w })) },
      // Points per copy exchanged, and to craft one (10×): exchange.md §2–3
      exchange: { values: EXCHANGE_VALUE, craftFactor: CRAFT_FACTOR, dailyPoints: EXCHANGE_DAILY_POINTS, craftDaily: CRAFT_DAILY },
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
    const count = parsed.data.count ?? 1
    const conflict = () => new PublicError('같은 요청 번호로 다른 개수의 카드팩을 열 수 없어요.', 409)
    // One pack keeps its answer shape; ten come back as a list with the guarantee flag
    const answer = async (kind: 'opened' | 'repeat', packs: OpenedPack[], guaranteed: boolean) => {
      const points = await this.services.points!.summary(user.id)
      return count === 1 ? { kind, pack: packView(packs[0]!), points } : { kind, packs: packs.map(packView), guaranteed, points }
    }
    // A retry of packs already opened gets those packs, even at the rate limit (qa B7-3)
    const prior = await this.packs.prior(user.id, parsed.data.idemKey)
    if (prior) {
      if (prior.length !== count) throw conflict()
      return answer('repeat', prior, false)
    }
    if (!packLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('카드팩은 1분에 10번까지 열 수 있어요.', 429)
    }
    const result = await this.packs.open(user.id, parsed.data.setId, parsed.data.idemKey, count, seed === undefined ? undefined : seededRng(seed), seed !== undefined)
    if (result.kind === 'conflict') throw conflict()
    if (result.kind === 'insufficient') {
      const cost = PACK_PRICE * count
      throw new PublicError(`포인트가 ${cost.toLocaleString('ko-KR')}P 필요해요 (${(cost - result.available).toLocaleString('ko-KR')}P 부족해요).`, 422)
    }
    return answer(result.kind, result.packs, result.guaranteed)
  }

  /** Duplicates to points (exchange.md §2): one copy always stays, listed and test copies never go */
  @Post('cards/exchange')
  @HttpCode(200)
  async exchange(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = ExchangeBody.safeParse(body)
    if (!parsed.success) throw badRequest()
    if (!cardLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('잠시 후 다시 시도해 주세요.', 429)
    }
    const r = await this.packs.exchange(user.id, parsed.data.cardId, parsed.data.count, parsed.data.idemKey)
    if (r.kind === 'not_found') throw new PublicError('카드팩에서 나오는 카드만 교환할 수 있어요.', 404)
    if (r.kind === 'too_many') throw new PublicError(r.available ? `지금은 ${r.available}장까지 교환할 수 있어요 (1장은 남겨요).` : '교환할 수 있는 카드가 없어요 (1장은 남기고, 경매 중인 카드는 빼요).', 409)
    if (r.kind === 'limit') throw new PublicError(`교환은 하루 ${EXCHANGE_DAILY_POINTS.toLocaleString('ko-KR')}P까지예요 (오늘 남은 ${r.left.toLocaleString('ko-KR')}P).`, 422)
    return { kind: r.kind, exchanged: r.exchanged, points: r.points, summary: await this.services.points!.summary(user.id) }
  }

  /** Points to one copy of a pack-pool card (exchange.md §3) */
  @Post('cards/craft')
  @HttpCode(200)
  async craft(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = CraftBody.safeParse(body)
    if (!parsed.success) throw badRequest()
    if (!cardLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('잠시 후 다시 시도해 주세요.', 429)
    }
    const r = await this.packs.craft(user.id, parsed.data.cardId, parsed.data.idemKey)
    if (r.kind === 'not_found') throw new PublicError('카드팩에서 나오는 카드만 만들 수 있어요.', 404)
    if (r.kind === 'limit') throw new PublicError(`카드는 하루 ${CRAFT_DAILY}장까지 만들 수 있어요.`, 422)
    if (r.kind === 'insufficient') throw new PublicError(`포인트가 ${r.cost.toLocaleString('ko-KR')}P 필요해요 (${(r.cost - r.available).toLocaleString('ko-KR')}P 부족해요).`, 422)
    return { kind: r.kind, cost: r.cost, summary: await this.services.points!.summary(user.id) }
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
