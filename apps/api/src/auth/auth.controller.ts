// Sign-in routes (docs/auth/design.md §4):
//   GET  /api/v1/auth/:provider/start?next=/decks   → the provider's sign-in page
//   GET  /api/v1/auth/:provider/callback?code&state → session cookie → next
//   POST /api/v1/auth/logout                         → 204
//   GET  /api/v1/me                                  → { user } or { user: null }
// Preview only: GET /api/v1/auth/test/authorize (the fake provider's consent step)

import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import type { Request, Response } from 'express'
import type { Config } from '../config.js'
import { clearCookie, OAUTH_COOKIE, readCookie, setCookie } from './cookies.js'
import { pkceChallenge, randomToken, safeEqual, seal, unseal } from './crypto.js'
import { isSafePath, safeNext } from './next.js'
import { SignInError, type Provider } from './providers.js'
import type { Sessions } from './sessions.js'
import type { AccountStore } from './store.js'
import { TEST_SUBJECT, type TestProvider } from './test-provider.js'

export const SERVICES = Symbol('SERVICES')

export interface Services {
  config: Config
  store: AccountStore | null
  sessions: Sessions | null
  /** Enabled providers by name; 'test' only on previews against the dev database */
  providers: Map<string, Provider>
  testProvider: TestProvider | null
  cookieKey: Buffer | null
}

/** What the oauth cookie carries between start and callback (10 minutes, single use) */
interface PendingSignIn {
  p: string
  s: string
  n: string
  v: string
  next: string
  exp: number
}

const PENDING_SECONDS = 600

function isPending(value: unknown): value is PendingSignIn {
  const v = value as PendingSignIn | null
  return (
    !!v &&
    typeof v.p === 'string' &&
    typeof v.s === 'string' &&
    typeof v.n === 'string' &&
    typeof v.v === 'string' &&
    typeof v.next === 'string' &&
    typeof v.exp === 'number'
  )
}

/** Default nickname until the user picks one (step 6): "트레이너" + 4 digits */
const defaultNickname = () => `트레이너${randomInt(1000, 10000)}`

/** Sign-in problems end on our own page with a fixed reason, never the provider's text (Security) */
type FailReason = 'cancelled' | 'expired' | 'failed'
const fail = (res: Response, reason: FailReason) => res.redirect(302, `/login?error=${reason}`)

@Controller()
export class AuthController {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  private provider(name: string) {
    const provider = this.services.providers.get(name)
    if (!provider || !this.services.cookieKey || !this.services.sessions) throw new NotFoundException()
    return provider
  }

  @Get('auth/:provider/start')
  start(@Param('provider') name: string, @Query() query: Record<string, unknown>, @Res() res: Response) {
    const provider = this.provider(name)
    let testSubject: string | undefined
    if (provider.name === 'test') {
      if (typeof query.sub !== 'string' || !TEST_SUBJECT.test(query.sub)) return fail(res, 'failed')
      testSubject = query.sub
    }
    const pending: PendingSignIn = {
      p: provider.name,
      s: randomToken(16),
      n: randomToken(16),
      v: randomToken(32),
      next: safeNext(query.next, this.services.config.PUBLIC_ORIGIN),
      exp: Math.floor(Date.now() / 1000) + PENDING_SECONDS,
    }
    setCookie(res, OAUTH_COOKIE, seal(pending, this.services.cookieKey!), PENDING_SECONDS)
    res.redirect(302, provider.authorizeUrl({ state: pending.s, nonce: pending.n, challenge: pkceChallenge(pending.v), testSubject }))
  }

  @Get('auth/:provider/callback')
  async callback(@Param('provider') name: string, @Query() query: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const provider = this.provider(name)
    // Single use: the cookie goes whatever happens next
    const sealed = readCookie(req, OAUTH_COOKIE)
    clearCookie(res, OAUTH_COOKIE)
    const pending = sealed ? unseal(sealed, this.services.cookieKey!) : null
    if (!isPending(pending) || pending.p !== provider.name || pending.exp < Date.now() / 1000) return fail(res, 'expired')
    if (typeof query.state !== 'string' || !safeEqual(query.state, pending.s)) return fail(res, 'expired')
    if (query.error !== undefined) return fail(res, query.error === 'access_denied' ? 'cancelled' : 'failed')
    if (typeof query.code !== 'string' || query.code.length === 0 || query.code.length > 4096) return fail(res, 'failed')
    try {
      const idToken = await provider.exchange(query.code, pending.v)
      const subject = await provider.verify(idToken, pending.n)
      const userId = await this.services.store!.signIn(provider.name, subject, defaultNickname())
      await this.services.sessions!.start(req, res, userId)
    } catch (error) {
      // Reason only: never the code, tokens or the provider's response
      console.warn(`sign-in failed (${provider.name}):`, error instanceof SignInError ? error.message : error instanceof Error ? error.name : 'unknown')
      return fail(res, 'failed')
    }
    // Relative: the browser stays on the site it started from (the callback URL drops code/state).
    // The path is checked once more here, whatever the cookie says (S3-1)
    res.redirect(302, isSafePath(pending.next) ? pending.next : '/')
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (this.services.sessions) await this.services.sessions.end(req, res)
  }

  @Get('me')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = this.services.sessions ? await this.services.sessions.current(req, res) : null
    if (!user) return { user: null }
    return { user: { nickname: user.nickname, providers: await this.services.store!.providersOf(user.id) } }
  }
}

/** Registered only when the test provider is on (preview + AUTH_TEST_PROVIDER=1 + dev database) */
@Controller('auth/test')
export class TestAuthController {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  @Get('authorize')
  async authorize(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const test = this.services.testProvider
    if (!test) throw new NotFoundException()
    const { state, nonce, code_challenge: challenge, sub } = query
    const ok = (v: unknown, max: number) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v) && v.length <= max
    if (!ok(state, 64) || !ok(nonce, 64) || !ok(challenge, 64) || typeof sub !== 'string' || !TEST_SUBJECT.test(sub)) {
      return fail(res, 'failed')
    }
    const code = await test.issueCode(sub, nonce as string, challenge as string)
    res.redirect(302, `/api/v1/auth/test/callback?${new URLSearchParams({ code, state: state as string })}`)
  }
}
