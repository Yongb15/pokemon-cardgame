import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import middleware from './middleware.js'

const ORIGIN = 'https://api.example.run.app'
const SECRET = 's'.repeat(40)
const SITE = 'https://site.example'

function call(path: string, headers: Record<string, string> = {}) {
  return middleware(new Request(`${SITE}${path}`, { headers }))
}
const target = (res: Response) => res.headers.get('x-middleware-rewrite')
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)

describe('the /api/v1 proxy', () => {
  beforeEach(() => {
    process.env.API_ORIGIN = ORIGIN
    process.env.PROXY_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.API_ORIGIN
    delete process.env.PROXY_SECRET
  })

  it('forwards to the server with the secret, overwriting what the client sent', () => {
    const res = call('/api/v1/me?x=1', { 'x-proxy-auth': 'forged', 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' })
    expect(target(res)).toBe(`${ORIGIN}/api/v1/me?x=1`)
    expect(forwarded(res, 'x-proxy-auth')).toBe(SECRET)
    expect(forwarded(res, 'x-vercel-forwarded-for')).toBeNull()
    expect(forwarded(res, 'x-forwarded-for')).toBeNull()
  })

  it('never forwards a path that leaves /api/v1 (Security A-1)', () => {
    for (const path of ['/api/v1/.%2e/.%2e/health', '/api/v1/%2e%2e/%2e%2e/health', '/api/v1/%2E%2E/x', '/api/v1/..%5c..%5chealth']) {
      const res = call(path)
      expect(target(res), path).toBeNull()
      expect(res.status, path).toBe(404)
    }
  })

  it('fails closed without a well-formed secret (Security A-4)', () => {
    for (const secret of [undefined, 'short', `${SECRET}\r`, ' '.repeat(40)]) {
      if (secret === undefined) delete process.env.PROXY_SECRET
      else process.env.PROXY_SECRET = secret
      const res = call('/api/v1/health')
      expect(res.status).toBe(503)
      expect(target(res)).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })
})
