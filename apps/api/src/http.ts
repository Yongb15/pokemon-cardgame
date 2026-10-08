// Express-level guards that run before any route (including unknown paths):
// - every response is no-store and carries the site's security headers (Security: a cached
//   Set-Cookie would hand one person's session to another)
// - only requests that came through our Vercel proxy get past (X-Proxy-Auth), except /health

import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Config } from './config.js'

export const HEALTH_PATH = '/api/v1/health'

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // An API never renders a page
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
  next()
}

/** Constant-time comparison; false for anything missing or of another length */
export function proxySecretMatches(given: unknown, secret: string | undefined) {
  if (!secret || secret.length < 32 || typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Requests must carry the proxy's secret; with no secret configured, nothing but /health passes */
export function proxyAuth(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    const verified = proxySecretMatches(req.headers['x-proxy-auth'], config.PROXY_SECRET)
    res.locals.proxyVerified = verified
    if (verified || req.path === HEALTH_PATH) return next()
    res.status(401).json({ error: { message: 'unauthorized', code: 401 } })
  }
}

/**
 * The visitor's IP, only from the headers Vercel sets, and only once the proxy is verified: a
 * direct caller could otherwise put any X-Forwarded-For and dodge rate limits (Security)
 */
export function clientIp(req: Request, res: Response) {
  if (!res.locals.proxyVerified) return null
  const value = req.headers['x-real-ip'] ?? req.headers['x-vercel-forwarded-for']
  const ip = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim()
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null
}
