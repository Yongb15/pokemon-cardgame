// Auction notifications (docs/auction/design.md §7d). Signed in only, no-store like every route.
//   GET  /api/v1/me/notifications        → { unread, items } (newest 20; the user's ended auctions settle
//        first, then their price alerts are checked, once an hour)
//   POST /api/v1/me/notifications/read   → { unread: 0 } (everything up to now; a write: origin-checked, limited)

import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { UserRoutes } from '../data/data.controller.js'
import { checkAlerts } from '../alerts/alerts.controller.js'
import { PublicError } from '../errors.js'

@Controller('me/notifications')
export class NotificationsController extends UserRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  private get notifications() {
    if (!this.services.notifications) throw new PublicError('잠시 후 다시 시도해 주세요.', 503)
    return this.services.notifications
  }

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    const user = await this.user(req, res)
    // No parameters at all, like the other strict routes (Security I-1)
    if (Object.keys(query).length) throw new PublicError('요청을 처리할 수 없습니다.', 400)
    // A "won" or "sold" exists once the auction is settled: settle the user's own ended ones first
    await this.services.auctions?.settleExpired(20, user.id)
    // Then this user's price alerts, at most once an hour, in their own transaction (Security PA-2)
    await checkAlerts(this.services, user.id)
    return this.notifications.list(user.id)
  }

  @Post('read')
  @HttpCode(200)
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    // Nothing to send: an unknown body is refused like elsewhere (qa 7d-3)
    if (body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body).length)) {
      throw new PublicError('요청을 처리할 수 없습니다.', 400)
    }
    await this.notifications.markRead(user.id)
    return { unread: 0 }
  }
}
