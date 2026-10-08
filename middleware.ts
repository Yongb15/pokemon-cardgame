// Vercel Routing Middleware: /api/v1/* goes to the NestJS server on Cloud Run under our own origin,
// so login cookies stay first-party and no CORS is needed (ADR 0003). vercel.json rewrites can't add
// request headers, so the proxy secret is attached here; the server refuses requests without it.

import { ipAddress } from '@vercel/functions/headers'
import { rewrite } from '@vercel/functions/middleware'

export const config = { matcher: '/api/v1/:path*' }

export default function middleware(request: Request) {
  const origin = process.env.API_ORIGIN
  const secret = process.env.PROXY_SECRET
  if (!origin || !secret) {
    // Fail closed: never forward without the secret
    return Response.json(
      { error: { message: '서버에 연결할 수 없습니다.', code: 503 } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  const url = new URL(request.url)
  const target = new URL(url.pathname + url.search, origin)
  const headers = new Headers(request.headers)
  // Overwrite anything the client sent under these names
  headers.set('x-proxy-auth', secret)
  headers.delete('x-forwarded-for')
  const ip = ipAddress(request)
  if (ip) headers.set('x-real-ip', ip)
  else headers.delete('x-real-ip')
  return rewrite(target, { request: { headers } })
}
