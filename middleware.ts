// Vercel Routing Middleware: /api/v1/* goes to the NestJS server on Cloud Run under our own origin,
// so login cookies stay first-party and no CORS is needed (ADR 0003). vercel.json rewrites can't add
// request headers, so the proxy secret is attached here; the server refuses requests without it.

import { ipAddress } from '@vercel/functions/headers'
import { rewrite } from '@vercel/functions/middleware'

export const config = { matcher: '/api/v1/:path*' }

const PREFIX = '/api/v1'
/** The format the secret is generated in (base64url): anything else is a setup mistake (Security A-4) */
const SECRET_FORMAT = /^[A-Za-z0-9_-]{32,256}$/

function fail(status: number, message: string) {
  return Response.json({ error: { message, code: status } }, { status, headers: { 'cache-control': 'no-store' } })
}

export default function middleware(request: Request) {
  const origin = process.env.API_ORIGIN
  const secret = process.env.PROXY_SECRET
  // Fail closed: never forward without a well-formed secret
  if (!origin || !secret || !SECRET_FORMAT.test(secret)) return fail(503, '서버에 연결할 수 없습니다.')
  const url = new URL(request.url)
  // Encoded dots or backslashes can climb out of /api/v1 once the path is parsed again (Security A-1)
  if (/%2e|%5c|\\/i.test(url.pathname)) return fail(404, '찾을 수 없습니다.')
  const target = new URL(url.pathname + url.search, origin)
  const inside = target.pathname === PREFIX || target.pathname.startsWith(`${PREFIX}/`)
  if (target.origin !== new URL(origin).origin || !inside) return fail(404, '찾을 수 없습니다.')
  const headers = new Headers(request.headers)
  // Overwrite anything the client sent under these names; the server reads the IP from x-real-ip only
  headers.set('x-proxy-auth', secret)
  headers.delete('x-forwarded-for')
  headers.delete('x-vercel-forwarded-for')
  const ip = ipAddress(request)
  if (ip) headers.set('x-real-ip', ip)
  else headers.delete('x-real-ip')
  return rewrite(target, { request: { headers } })
}
