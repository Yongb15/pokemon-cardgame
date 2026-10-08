// Cookies the API sets. `__Host-` makes the browser refuse them unless they are Secure, have no
// Domain and Path=/ — so no subdomain or plain-http page can plant or read them (Security)

import type { Request, Response } from 'express'

export const SESSION_COOKIE = '__Host-session'
export const OAUTH_COOKIE = '__Host-oauth'

/** One cookie's value from the request, only if it looks like something we set (base64url) */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue
    const value = part.slice(eq + 1).trim()
    return /^[A-Za-z0-9_-]{1,4096}$/.test(value) ? value : null
  }
  return null
}

export function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.append('Set-Cookie', `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Lax`)
}

export function clearCookie(res: Response, name: string) {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
}
