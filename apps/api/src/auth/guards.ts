// Request guards for sign-in and every state-changing route

import type { NextFunction, Request, Response } from 'express'
import type { Config } from '../config.js'
import { clientIp } from '../http.js'
import { readCookie, SESSION_COOKIE } from './cookies.js'

/** This project's Vercel previews (team dydqls-projects) — never every *.vercel.app (Security) */
const PREVIEW_ORIGIN = /^https:\/\/pokemon-card-dex-[a-z0-9-]{1,40}-dydqls-projects\.vercel\.app$/

export function originAllowed(config: Config, origin: string | undefined) {
  if (!origin) return false
  if (origin === new URL(config.PUBLIC_ORIGIN).origin) return true
  return config.APP_ENV === 'preview' && PREVIEW_ORIGIN.test(origin)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF: a state-changing request must say it comes from our site (Origin), and a missing Origin
 * counts as foreign. Cookies are SameSite=Lax too; there is no CORS, so no other site can read
 * our answers (Security)
 */
export function originCheck(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || originAllowed(config, req.headers.origin)) return next()
    res.status(403).json({ error: { message: '권한이 없습니다.', code: 403 } })
  }
}

/**
 * Fixed-window limits per visitor IP, in memory (at most 2 instances, so the real limit is at
 * most twice this). Enough to stop a loop or a script hammering sign-in.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string) {
    const now = this.now()
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
    }
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= this.max
  }

  /**
   * Express middleware keyed by the visitor's IP (only known through the verified proxy). Requests
   * without a known IP share one much larger bucket instead, so one visitor can't lock everyone
   * out if the header ever goes missing (Security S3-2); that case is logged, at most once a minute
   */
  middleware(unknownMax = this.max * 10) {
    const shared = new RateLimiter(unknownMax, this.windowMs, this.now)
    let warnedAt = -Infinity
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = clientIp(req, res)
      if (!ip && this.now() - warnedAt >= 60_000) {
        warnedAt = this.now()
        console.warn('rate limit: request without a visitor IP (x-real-ip missing)')
      }
      if (ip ? this.allow(ip) : shared.allow('unknown')) return next()
      res.setHeader('Retry-After', String(Math.ceil(this.windowMs / 1000)))
      res.status(429).json({ error: { message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', code: 429 } })
    }
  }
}

/** 401 before parsing anything when there's no session cookie at all (the session itself is checked later) */
export function requireSessionCookie(req: Request, res: Response, next: NextFunction) {
  if (readCookie(req, SESSION_COOKIE)) return next()
  res.status(401).json({ error: { message: '로그인이 필요합니다.', code: 401 } })
}
