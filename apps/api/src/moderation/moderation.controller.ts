// Reports and moderation (docs/auction/moderation.md, Security AD-1..AD-4).
//   POST /api/v1/me/auctions/:id/report { reason, note? } → 201 { result } (200 for a repeat; 403 own; 404; 429 at 10 a day)
// Admins only — anyone else, or an admin whose sign-in is over 12 hours old, gets 404 (AD-1):
//   GET  /api/v1/admin/reports                 → { auctions } (open reports, oldest first)
//   GET  /api/v1/admin/auctions/:id            → { auction } (bids with an admin-only pseudonym, reports, actions)
//   POST /api/v1/admin/auctions/:id/dismiss    { reason } → { result }
//   POST /api/v1/admin/auctions/:id/remove     { reason } → { result }  (open auctions; 409 conflicted or closed)
// Point grants (docs/auction/admin-points.md):
//   GET  /api/v1/admin/members/:code           → { member: { code, nickname, joinedAt, pseudonym } } (30/min)
//   POST /api/v1/admin/points/grant            { code, amount, reason, idemKey } → { result, grantId }
//        (403 an admin, 404 no such member, 409 over the daily limit or a reused key)
//   GET  /api/v1/admin/points/grants           → { grants } (last 30 days)

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { cleanText } from '@card-dex/shared'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { RateLimiter } from '../auth/guards.js'
import type { CurrentUser } from '../auth/sessions.js'
import { UserRoutes } from '../data/data.controller.js'
import { PublicError } from '../errors.js'
import { GRANT_DAILY_MAX, GRANT_IDEM, GRANT_MAX, MEMBER_CODE } from './grants.js'
import { REPORT_REASONS } from './store.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)
const notFound = () => new PublicError('찾을 수 없습니다.', 404)
/** Admin powers need a sign-in from the last 12 hours, not a month-old sliding cookie (AD-1) */
export const ADMIN_FRESH_MS = 12 * 60 * 60 * 1000
const adminWrites = new RateLimiter(20, 60_000)
const memberLookups = new RateLimiter(30, 60_000)

/** "7f3a-9c21", " 7F3A9C21 " → "7F3A9C21"; anything else null */
const memberCode = (raw: unknown) => {
  const code = typeof raw === 'string' ? raw.replace(/[\s-]/g, '').toUpperCase() : ''
  return MEMBER_CODE.test(code) ? code : null
}
// A grant reason is the admin's note, not a place for anyone's contact details (R-3)
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE = /\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{4}/

/** Over 200 is refused (Security I-1); control and direction characters out (AD-3); empty → null */
const text200 = z
  .string()
  .max(200)
  .transform((value) => cleanText(value, 200))

const Report = z.strictObject({
  reason: z.enum(REPORT_REASONS),
  note: text200.optional(),
})
const Reason = z.strictObject({ reason: text200.refine((value) => value.length > 0) })
const Grant = z.strictObject({
  code: z.string().max(20),
  amount: z.number().int().min(1).max(GRANT_MAX),
  reason: text200.refine((value) => value.length > 0 && !EMAIL.test(value) && !PHONE.test(value)),
  idemKey: z.string().regex(GRANT_IDEM),
})

abstract class ModerationRoutes extends UserRoutes {
  protected get moderation() {
    if (!this.services.moderation) throw notFound()
    return this.services.moderation
  }

  protected id(raw: string) {
    if (!UUID.test(raw)) throw notFound()
    return raw
  }
}

@Controller('me/auctions')
export class ReportsController extends ModerationRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Post(':id/report')
  @HttpCode(201)
  async report(@Param('id') raw: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    const parsed = Report.safeParse(body)
    if (!parsed.success) throw badRequest()
    const result = await this.moderation.report(user.id, this.id(raw), parsed.data.reason, parsed.data.note || null)
    if (result === 'not_found') throw notFound()
    if (result === 'own') throw new PublicError('내 경매는 신고할 수 없어요.', 403)
    if (result === 'limit') {
      res.setHeader('Retry-After', '3600')
      throw new PublicError('신고는 하루 10건까지 할 수 있어요.', 429)
    }
    if (result === 'repeat') res.status(200)
    return { result: 'ok' }
  }
}

@Controller('admin')
export class AdminController extends ModerationRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  /** Session → admins row → a recent sign-in, on every request; anything else is 404 (AD-1) */
  private async admin(req: Request, res: Response, write: boolean): Promise<CurrentUser> {
    let user: CurrentUser
    try {
      user = write ? await this.writer(req, res) : await this.user(req, res)
    } catch (error) {
      if (error instanceof PublicError && error.getStatus() === 429) throw error
      throw notFound()
    }
    if (!(await this.moderation.isAdmin(user.id))) throw notFound()
    if (Date.now() - user.signedInAt.getTime() > ADMIN_FRESH_MS) throw notFound()
    if (write && !adminWrites.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('잠시 후 다시 시도해 주세요.', 429)
    }
    return user
  }

  @Get('reports')
  async reports(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    await this.admin(req, res, false)
    if (Object.keys(query).length) throw badRequest()
    return { auctions: await this.moderation.reported() }
  }

  @Get('auctions/:id')
  async auction(@Param('id') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.admin(req, res, false)
    const auction = await this.moderation.auction(this.id(raw), this.services.pseudonym)
    if (!auction) throw notFound()
    return { auction }
  }

  @Post('auctions/:id/dismiss')
  @HttpCode(200)
  async dismiss(@Param('id') raw: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const admin = await this.admin(req, res, true)
    const parsed = Reason.safeParse(body)
    if (!parsed.success) throw badRequest()
    const result = await this.moderation.dismiss(admin.id, this.id(raw), parsed.data.reason)
    return this.answer(result)
  }

  @Post('auctions/:id/remove')
  @HttpCode(200)
  async remove(@Param('id') raw: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const admin = await this.admin(req, res, true)
    const parsed = Reason.safeParse(body)
    if (!parsed.success) throw badRequest()
    const result = await this.moderation.remove(admin.id, this.id(raw), parsed.data.reason)
    return this.answer(result)
  }

  private get grants() {
    if (!this.services.grants) throw notFound()
    return this.services.grants
  }

  @Get('members/:code')
  async member(@Param('code') raw: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const admin = await this.admin(req, res, false)
    if (!memberLookups.allow(admin.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('잠시 후 다시 시도해 주세요.', 429)
    }
    const code = memberCode(raw)
    // Malformed, unknown and deleted codes all get the same answer
    const member = code ? await this.grants.member(code) : null
    if (!code || !member) throw new PublicError('회원을 찾을 수 없어요.', 404)
    return { member: { code, nickname: member.nickname, joinedAt: member.joinedAt, pseudonym: this.services.pseudonym(member.userId) } }
  }

  @Post('points/grant')
  @HttpCode(200)
  async grant(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const admin = await this.admin(req, res, true)
    const parsed = Grant.safeParse(body)
    const code = parsed.success ? memberCode(parsed.data.code) : null
    if (!parsed.success || !code) throw badRequest()
    const { amount, reason, idemKey } = parsed.data
    const result = await this.grants.grant(admin.id, code, amount, reason, idemKey)
    if (result.kind === 'not_found') throw new PublicError('회원을 찾을 수 없어요.', 404)
    if (result.kind === 'admin_target') throw new PublicError('관리자 계정에는 지급할 수 없어요.', 403)
    if (result.kind === 'idem_conflict') throw new PublicError('같은 요청이 다른 내용으로 이미 처리됐어요. 새로 시도해 주세요.', 409)
    if (result.kind === 'limit') {
      const left = Math.max(0, GRANT_DAILY_MAX - result.usedToday)
      throw new PublicError(`오늘 지급 한도(${GRANT_DAILY_MAX.toLocaleString('ko-KR')}P)를 넘어요. 오늘 남은 한도는 ${left.toLocaleString('ko-KR')}P예요.`, 409)
    }
    // Ids and amounts only in logs: never a nickname or member code (Security)
    if (!result.replay) console.log(`admin grant ${result.grantId} amount=${amount}`)
    return { result: 'ok', grantId: result.grantId }
  }

  @Get('points/grants')
  async recentGrants(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: Record<string, unknown>) {
    await this.admin(req, res, false)
    if (Object.keys(query).length) throw badRequest()
    const grants = await this.grants.recent()
    // The pseudonym is worked out here, never stored (R-5); no user id leaves the server
    return {
      grants: grants.map(({ userId, ...g }) => ({ ...g, pseudonym: userId ? this.services.pseudonym(userId) : null })),
    }
  }

  private answer(result: string) {
    if (result === 'not_found') throw notFound()
    if (result === 'conflict') throw new PublicError('내가 판매하거나 입찰한 경매는 처리할 수 없어요.', 409)
    if (result === 'closed') throw new PublicError('진행 중인 경매만 내릴 수 있어요.', 409)
    if (result === 'nothing') throw new PublicError('열린 신고가 없어요.', 409)
    return { result }
  }
}
