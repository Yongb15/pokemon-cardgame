// Points routes (docs/auction/design.md §2, M7 step 7a). Every route needs a session; writes are
// also limited per user and checked by origin (the app's guards).
//   GET  /api/v1/me/points                    → summary (the first bonus is granted on first look:
//        a GET with a write side effect, accepted only because it is idempotent and only ever
//        benefits the signed-in user — Security I-2. Don't copy this for writes that matter)
//   GET  /api/v1/me/points/entries?before=…   → { entries, next } (newest first, 20 a page)
//   POST /api/v1/me/points/daily              → { claimed, ...summary } (today in Korea, once)
// Preview only, test accounts only, own data only (Security T-1, T-2, T-4, T-5):
//   POST /api/v1/test/points { amount, idemKey } → { result, ...summary }
//   GET  /api/v1/test/ledger-check              → { mine, all (counts) }

import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { UserRoutes } from '../data/data.controller.js'
import { PublicError } from '../errors.js'

/** "<ISO time>_<uuid>" of the last entry on the page */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)

abstract class PointRoutes extends UserRoutes {
  protected get points() {
    if (!this.services.points) throw new PublicError('잠시 후 다시 시도해 주세요.', 503)
    return this.services.points
  }
}

@Controller('me/points')
export class PointsController extends PointRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get()
  async summary(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return this.points.summary(user.id)
  }

  @Get('entries')
  async entries(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    const user = await this.user(req, res)
    // "before" is the only parameter, like the other strict routes (Security I-1)
    if (Object.keys(query).some((key) => key !== 'before')) throw badRequest()
    const before = query.before
    let cursor: { createdAt: Date; id: string } | null = null
    if (before !== undefined) {
      const m = typeof before === 'string' ? CURSOR.exec(before) : null
      if (!m || Number.isNaN(Date.parse(m[1]!))) throw badRequest()
      cursor = { createdAt: new Date(m[1]!), id: m[2]! }
    }
    const entries = await this.points.entries(user.id, cursor)
    const last = entries.length === 20 ? entries.at(-1) : undefined
    return {
      entries: entries.map((e) => ({ id: e.id, amount: e.amount, kind: e.kind, createdAt: e.createdAt.toISOString() })),
      next: last ? `${last.createdAt.toISOString()}_${last.id}` : null,
    }
  }

  @Post('daily')
  @HttpCode(200)
  async daily(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    const { claimed, summary } = await this.points.claimDaily(user.id)
    return { claimed, ...summary }
  }
}

const TopUp = z.strictObject({
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0 && Math.abs(n) <= 1_000_000),
  idemKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
})

/** Registered only with the test sign-in (preview + dev database): test accounts, their own data */
@Controller('test')
export class TestDataController extends PointRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  /** A signed-in account whose only sign-in method is the test provider (else 403: Security T-2) */
  private async testUser(req: Request, res: Response, write: boolean) {
    const user = write ? await this.writer(req, res) : await this.user(req, res)
    const providers = await this.services.store!.providersOf(user.id)
    if (!providers.length || providers.some((p) => p !== 'test')) throw new PublicError('테스트 계정만 쓸 수 있어요.', 403)
    return user
  }

  @Post('points')
  @HttpCode(200)
  async topUp(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.testUser(req, res, true)
    const parsed = TopUp.safeParse(body)
    if (!parsed.success) throw badRequest()
    const result = await this.points.adjust(user.id, parsed.data.amount, `test:${parsed.data.idemKey}`)
    if (result === 'insufficient') throw new PublicError('잔액이 모자라요.', 422)
    return { result, ...(await this.points.summary(user.id)) }
  }

  @Get('ledger-check')
  async ledgerCheck(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.testUser(req, res, false)
    return this.points.ledgerCheck(user.id)
  }
}
