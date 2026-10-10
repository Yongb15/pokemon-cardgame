// The signed-in user's data (docs/auth/design.md §2, §5). Every route needs a session (401
// otherwise); writes are also limited per user. Ids that aren't ours, or aren't ids at all, are 404.
//   GET    /api/v1/decks                  → { decks }
//   POST   /api/v1/decks                  → 201 { deck }        422 at the 100-deck limit
//   GET    /api/v1/decks/:id              → { deck }
//   PUT    /api/v1/decks/:id  {…, version} → { deck }            409 when another device saved first
//   DELETE /api/v1/decks/:id              → 204
//   POST   /api/v1/decks/import           → { imported, duplicates, overLimit, invalid }
//   GET    /api/v1/favorites              → { cards }
//   PUT    /api/v1/favorites/:cardId      → 204                 422 at the 500-card limit
//   DELETE /api/v1/favorites/:cardId      → 204
//   GET    /api/v1/me/summary             → { decks, favorites } (counts for the leave dialog)
//   PATCH  /api/v1/me  { nickname }       → { user }
//   POST   /api/v1/me/logout-all          → 204 (every device)
//   DELETE /api/v1/me  { confirm }        → 204 (the account and everything in it; confirm = nickname)

import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req, Res } from '@nestjs/common'
import { cleanNickname, cleanText, isCardId, MAX_DECKS } from '@card-dex/shared'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { SERVICES, type Services } from '../auth/auth.controller.js'
import { clearCookie, SESSION_COOKIE } from '../auth/cookies.js'
import type { CurrentUser } from '../auth/sessions.js'
import { PublicError } from '../errors.js'
import { deckView, parseDeck, parseDeckUpdate, parseImport } from './decks.js'
import { MAX_FAVORITES } from './store.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const notFound = () => new PublicError('찾을 수 없습니다.', 404)
const badRequest = () => new PublicError('요청을 처리할 수 없습니다.', 400)

/** Shared by the controllers below: the session's user, and the per-user write limit */
export abstract class UserRoutes {
  constructor(protected readonly services: Services) {}

  protected get data() {
    return this.services.data!
  }

  protected async user(req: Request, res: Response): Promise<CurrentUser> {
    const user = this.services.sessions && this.services.data ? await this.services.sessions.current(req, res) : null
    if (!user) throw new PublicError('로그인이 필요합니다.', 401)
    return user
  }

  /** A signed-in user about to change something: at most 60 writes a minute (Security: write limits) */
  protected async writer(req: Request, res: Response) {
    const user = await this.user(req, res)
    if (!this.services.writeLimit.allow(user.id)) {
      res.setHeader('Retry-After', '60')
      throw new PublicError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429)
    }
    return user
  }
}

@Controller('decks')
export class DecksController extends UserRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return { decks: (await this.data.listDecks(user.id)).map(deckView) }
  }

  // 200, not 201: an import may create nothing (all duplicates)
  @Post('import')
  @HttpCode(200)
  async import(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = parseImport(body)
    if (!parsed) throw badRequest()
    return { ...(await this.data.importDecks(user.id, parsed.items)), invalid: parsed.invalid }
  }

  @Post()
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const input = parseDeck(body)
    if (!input) throw badRequest()
    const deck = await this.data.createDeck(user.id, input)
    if (!deck) throw new PublicError(`덱은 ${MAX_DECKS}개까지 저장할 수 있어요.`, 422)
    res.status(201)
    return { deck: deckView(deck) }
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    const deck = UUID.test(id) ? await this.data.getDeck(user.id, id) : null
    if (!deck) throw notFound()
    return { deck: deckView(deck) }
  }

  @Put(':id')
  async save(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    if (!UUID.test(id)) throw notFound()
    const input = parseDeckUpdate(body)
    if (!input) throw badRequest()
    const result = await this.data.updateDeck(user.id, id, input, input.version)
    if (result === 'not-found') throw notFound()
    if (result === 'conflict') throw new PublicError('다른 기기에서 이 덱이 바뀌었어요.', 409)
    return { deck: deckView(result) }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!UUID.test(id) || !(await this.data.deleteDeck(user.id, id))) throw notFound()
  }
}

@Controller('favorites')
export class FavoritesController extends UserRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return { cards: await this.data.listFavorites(user.id) }
  }

  @Put(':cardId')
  @HttpCode(204)
  async add(@Param('cardId') cardId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!isCardId(cardId)) throw notFound()
    if (!(await this.data.addFavorite(user.id, cardId))) {
      throw new PublicError(`관심 카드는 ${MAX_FAVORITES}장까지 담을 수 있어요.`, 422)
    }
  }

  @Delete(':cardId')
  @HttpCode(204)
  async remove(@Param('cardId') cardId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    if (!isCardId(cardId)) throw notFound()
    await this.data.removeFavorite(user.id, cardId)
  }
}

@Controller('me')
export class MeController extends UserRoutes {
  constructor(@Inject(SERVICES) services: Services) {
    super(services)
  }

  @Get('summary')
  async summary(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.user(req, res)
    return await this.data.counts(user.id)
  }

  @Patch()
  async rename(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = z.strictObject({ nickname: z.string().max(200) }).safeParse(body)
    const nickname = parsed.success ? cleanNickname(parsed.data.nickname) : null
    if (!nickname) throw new PublicError('닉네임은 2~20자로 정해 주세요.', 400)
    await this.data.setNickname(user.id, nickname)
    return { user: { nickname, providers: await this.services.store!.providersOf(user.id) } }
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.writer(req, res)
    await this.data.deleteSessions(user.id)
    clearCookie(res, SESSION_COOKIE)
  }

  /** The user types their nickname to confirm: no account goes by a stray click or script (Security S5-2) */
  @Delete()
  @HttpCode(204)
  async leave(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const user = await this.writer(req, res)
    const parsed = z.strictObject({ confirm: z.string().max(200) }).safeParse(body)
    // Cleaned but never cut: "<20-character nickname>x" must not match (qa D5-1)
    if (!parsed.success || cleanText(parsed.data.confirm, 200) !== user.nickname) {
      throw new PublicError('확인을 위해 지금 닉네임을 정확히 입력해 주세요.', 400)
    }
    // With auctions: under the account lock, and refused while seller or top bidder of an open one (Security)
    if (this.services.auctions) {
      const result = await this.services.auctions.leave(user.id)
      if (result.kind === 'blocked') {
        throw new PublicError('진행 중인 경매의 판매자이거나 최고 입찰자라 지금은 탈퇴할 수 없어요. 경매가 끝난 뒤 다시 시도해 주세요.', 409)
      }
    } else await this.data.deleteUser(user.id)
    clearCookie(res, SESSION_COOKIE)
  }
}
