// Sessions (ADR 0004): a random token in the __Host-session cookie, its SHA-256 in the database.
// 30 days that slide with use (recorded at most once a day), never past 90 days from sign-in.

import type { Request, Response } from 'express'
import { clearCookie, readCookie, setCookie, SESSION_COOKIE } from './cookies.js'
import { randomToken, sha256 } from './crypto.js'
import type { AccountStore } from './store.js'

const DAY = 24 * 60 * 60 * 1000
export const SESSION_DAYS = 30
export const ABSOLUTE_DAYS = 90
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export interface CurrentUser {
  id: string
  nickname: string
}

export class Sessions {
  constructor(
    private readonly store: AccountStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * A new session for a fresh sign-in (always a new token: no session fixation). A session this
   * browser already had is ended first, so it doesn't linger until it expires (Security I3-2)
   */
  async start(req: Request, res: Response, userId: string) {
    const previous = readCookie(req, SESSION_COOKIE)
    if (previous && TOKEN.test(previous)) await this.store.deleteSession(sha256(previous))
    const token = randomToken(32)
    await this.store.createSession(userId, sha256(token), new Date(this.now().getTime() + SESSION_DAYS * DAY))
    setCookie(res, SESSION_COOKIE, token, SESSION_DAYS * DAY / 1000)
  }

  /** The signed-in user, or null; slides the expiry when the last recorded use is a day old */
  async current(req: Request, res: Response): Promise<CurrentUser | null> {
    const token = readCookie(req, SESSION_COOKIE)
    if (!token) return null
    const now = this.now()
    const session = TOKEN.test(token) ? await this.store.findSession(sha256(token), now) : null
    if (!session) {
      // Expired, signed out elsewhere or forged: drop the cookie too
      clearCookie(res, SESSION_COOKIE)
      return null
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= DAY) {
      const cap = session.createdAt.getTime() + ABSOLUTE_DAYS * DAY
      const expiresAt = new Date(Math.min(now.getTime() + SESSION_DAYS * DAY, cap))
      await this.store.extendSession(sha256(token), expiresAt, now)
      setCookie(res, SESSION_COOKIE, token, (expiresAt.getTime() - now.getTime()) / 1000)
    }
    return { id: session.userId, nickname: session.nickname }
  }

  /** Sign out this browser: the session row goes, so the token is dead even if copied */
  async end(req: Request, res: Response) {
    const token = readCookie(req, SESSION_COOKIE)
    if (token && TOKEN.test(token)) await this.store.deleteSession(sha256(token))
    clearCookie(res, SESSION_COOKIE)
  }
}
