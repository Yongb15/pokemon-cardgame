// Price alerts (docs/price/alerts.md §4, Security PA-3). Signed in only, no-store; writes are
// origin-checked and limited per user.
//   GET    /api/v1/me/price-alerts           → { alerts: [{ cardId, targetKrw, active, triggeredAt }] }
//   PUT    /api/v1/me/price-alerts/:cardId   { targetKrw } → { alert, krw } (re-armed); 404 unknown card, 422 over 50
//   DELETE /api/v1/me/price-alerts/:cardId   → 204

import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { UserRoutes } from '../data/data.controller.js'
import { PublicError } from '../errors.js'
import { MAX_ALERTS, MAX_TARGET, MIN_TARGET } from './store.js'

const CARD_ID = /^[A-Za-z0-9_.!?-]{1,40}$/
const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)
const notFound = () => new PublicError('카드를 찾을 수 없어요.', 404)

const Save = z.strictObject({
  targetKrw: z
    .number()
    .int()
    .min(MIN_TARGET)
    .max(MAX_TARGET)
    .refine((n) => n % 100 === 0),
})

@Controller('me/price-alerts')
export class PriceAlertsController extends UserRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  private get alerts() {
    if (!this.services.alerts || !this.services.prices) throw new PublicError('잠시 후 다시 시도해 주세요.', 503)
    return { store: this.services.alerts, prices: this.services.prices }
  }

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    const user = await this.user(req, res)
    if (Object.keys(query).length) throw badRequest()
    return { alerts: await this.alerts.store.list(user.id) }
  }

  @Put(':cardId')
  async save(@Param('cardId') cardId: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!CARD_ID.test(cardId)) throw notFound()
    const parsed = Save.safeParse(body)
    if (!parsed.success) throw badRequest()
    const { store, prices } = this.alerts
    // Only real cards are stored: the price function knows the card index (Security PA-3)
    const current = await prices([cardId])
    if (current === 'unknown') throw notFound()
    if (current === null) throw new PublicError('시세를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 503)
    if ((await store.save(user.id, cardId, parsed.data.targetKrw)) === 'limit') {
      throw new PublicError(`가격 알림은 ${MAX_ALERTS}장까지 걸 수 있어요.`, 422)
    }
    return { alert: { cardId, targetKrw: parsed.data.targetKrw, active: true, triggeredAt: null }, krw: current.get(cardId) ?? null }
  }

  @Delete(':cardId')
  @HttpCode(204)
  async remove(@Param('cardId') cardId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!CARD_ID.test(cardId)) throw notFound()
    await this.alerts.store.remove(user.id, cardId)
  }
}

/** The lazy check on reading notifications: claim (once an hour), fetch, fire. Never throws */
export async function checkAlerts(services: Services, userId: string) {
  const { alerts, prices } = services
  if (!alerts || !prices) return
  try {
    const armed = await alerts.claimCheck(userId)
    if (!armed.length) return
    const current = await prices(armed.map((a) => a.cardId))
    if (!current || current === 'unknown') return
    const hits = armed.flatMap((a) => {
      const krw = current.get(a.cardId)
      return krw !== undefined && krw <= a.targetKrw ? [{ ...a, krw }] : []
    })
    await alerts.fire(userId, hits)
  } catch (error) {
    console.warn('price alert check failed:', error instanceof Error ? error.name : 'unknown')
  }
}
