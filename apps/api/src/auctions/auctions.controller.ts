// Auctions (docs/auction/design.md). Public reads are edge-cached briefly (Security A-4: viewers are
// absorbed by the CDN, the database sees at most one read per auction every 2 s); the viewer's own
// side and every write are per session, no-store, limited per user and origin-checked.
//   GET  /api/v1/auctions?sort=ending|new|price&set=&page=   → { items, more }
//   GET  /api/v1/auctions/:id                                → public state (ETag, s-maxage=2)
//   GET  /api/v1/me/auctions                                 → { selling, bidding }
//   GET  /api/v1/me/auctions/:id                             → { mine, serverNow }
//   POST /api/v1/me/auctions { cardId, startPrice, duration, idemKey }   → { auctionId }
//   POST /api/v1/me/auctions/:id/bids { amount, idemKey }               → { result, state, mine, serverNow }
//   POST /api/v1/me/auctions/:id/cancel                                 → { result }
// Preview only, test accounts only: POST /api/v1/test/auctions/:id/ends-in { seconds }, POST /api/v1/test/auctions/settle

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { RateLimiter } from '../auth/guards.js'
import { UserRoutes } from '../data/data.controller.js'
import { PublicError } from '../errors.js'
import { PACK_SETS } from '../packs/odds.js'
import { DURATIONS, MAX_PRICE, MIN_START, MIN_STEP, TEST_DURATIONS } from './store.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const IDEM = /^[A-Za-z0-9_-]{8,64}$/
const CARD_ID = /^[A-Za-z0-9_.!?-]{1,40}$/
const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)
const notFound = () => new PublicError('경매를 찾을 수 없어요.', 404)

/** Bids: twenty a minute per user, on top of the general write limit */
const bidLimit = new RateLimiter(20, 60_000)
/** Cancelling: five a minute (Security: cap cancel attempts) */
const cancelLimit = new RateLimiter(5, 60_000)

const price = z.number().int().min(MIN_START).max(MAX_PRICE).refine((n) => n % MIN_STEP === 0)

abstract class AuctionRoutes extends UserRoutes {
  protected get auctions() {
    if (!this.services.auctions) throw new PublicError('잠시 후 다시 시도해 주세요.', 503)
    return this.services.auctions
  }

  protected id(raw: string) {
    if (!UUID.test(raw)) throw notFound()
    return raw
  }
}

@Controller('auctions')
export class AuctionsPublicController extends AuctionRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get()
  async market(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    if (Object.keys(query).some((k) => !['sort', 'set', 'page'].includes(k))) throw badRequest()
    const sort = query.sort ?? 'ending'
    if (sort !== 'ending' && sort !== 'new' && sort !== 'price') throw badRequest()
    const set = query.set
    if (set !== undefined && (typeof set !== 'string' || !PACK_SETS.some((s) => s.id === set))) throw badRequest()
    const page = query.page === undefined ? 0 : typeof query.page === 'string' && /^\d{1,2}$/.test(query.page) ? Number(query.page) : -1
    if (page < 0) throw badRequest()
    const result = await this.auctions.market(sort, set ? `${set}-` : null, page)
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=2')
    return result
  }

  @Get(':id')
  async state(@Param('id') raw: string, @Req() req: Request, @Res() res: Response) {
    const state = await this.auctions.get(this.id(raw))
    if (!state) throw notFound()
    const etag = `W/"${state.id}-${state.version}-${state.status}"`
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=2')
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end()
      return
    }
    // Not a clock to set the countdown by: it may be up to 2 s old (qa: offsets come from no-store answers)
    res.json({ ...state, cachedAt: new Date().toISOString() })
  }
}

const ListBody = z.strictObject({
  cardId: z.string().regex(CARD_ID),
  startPrice: price,
  duration: z.string(),
  idemKey: z.string().regex(IDEM),
})
const BidBody = z.strictObject({ amount: price, idemKey: z.string().regex(IDEM) })

@Controller('me/auctions')
export class MyAuctionsController extends AuctionRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return this.auctions.myAuctions(user.id)
  }

  @Get(':id')
  async mine(@Param('id') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return { mine: await this.auctions.mine(this.id(raw), user.id), serverNow: new Date().toISOString() }
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = ListBody.safeParse(body)
    if (!parsed.success) throw badRequest()
    const durations = this.services.testProvider ? { ...DURATIONS, ...TEST_DURATIONS } : DURATIONS
    if (!Object.hasOwn(durations, parsed.data.duration)) throw badRequest()
    const result = await this.auctions.list(user.id, parsed.data.cardId, parsed.data.startPrice, durations[parsed.data.duration]!, parsed.data.idemKey)
    if (result.kind !== 'listed' && result.kind !== 'repeat') {
      throw new PublicError(
        result.kind === 'limit' ? '진행 중인 경매는 10개까지 올릴 수 있어요.' : '경매에 올릴 수 있는 카드가 없어요. 이미 경매 중이거나 테스트 카드일 수 있어요.',
        422,
      )
    }
    return { auctionId: result.auctionId, kind: result.kind }
  }

  @Post(':id/bids')
  @HttpCode(200)
  async bid(@Param('id') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const id = this.id(raw)
    const parsed = BidBody.safeParse(body)
    if (!parsed.success) throw badRequest()
    if (!bidLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('입찰은 1분에 20번까지 할 수 있어요.', 429)
    }
    const result = await this.auctions.bid(user.id, id, parsed.data.amount, parsed.data.idemKey)
    if (result.kind === 'not_found') throw notFound()
    // Everything else answers with the latest state, so the screen can explain and recover (qa §9)
    const [state, mine] = await Promise.all([this.auctions.get(id), this.auctions.mine(id, user.id)])
    return { result, state, mine, serverNow: new Date().toISOString() }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!cancelLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('잠시 후 다시 시도해 주세요.', 429)
    }
    const result = await this.auctions.cancel(user.id, this.id(raw))
    if (result === 'not_found') throw notFound()
    if (result === 'has_bids') throw new PublicError('입찰이 있어 취소할 수 없어요.', 409)
    if (result === 'closed') throw new PublicError('이미 끝난 경매예요.', 409)
    return { result }
  }
}

/** Registered only with the test sign-in (preview + dev database), test accounts only */
@Controller('test/auctions')
export class TestAuctionsController extends AuctionRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  private async testOnly(req: Request, res: Response) {
    const user = await this.writer(req, res)
    const providers = await this.services.store!.providersOf(user.id)
    if (!providers.length || providers.some((p) => p !== 'test')) throw new PublicError('테스트 계정만 쓸 수 있어요.', 403)
    return user
  }

  @Post(':id/ends-in')
  @HttpCode(204)
  async endsIn(@Param('id') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.testOnly(req, res)
    const parsed = z.strictObject({ seconds: z.number().int().min(1).max(600) }).safeParse(body)
    if (!parsed.success) throw badRequest()
    if (!(await this.auctions.endsIn(user.id, this.id(raw), parsed.data.seconds))) throw notFound()
  }

  @Post('settle')
  @HttpCode(200)
  async settle(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.testOnly(req, res)
    return { settled: await this.auctions.settleExpired(50) }
  }
}
