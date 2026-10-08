import type { INestApplication } from '@nestjs/common'
import type { Request, Response } from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadConfig, type Config } from './config.js'
import { clientIp, proxySecretMatches } from './http.js'

const SECRET = 's'.repeat(40)
const baseEnv = { APP_ENV: 'preview', PUBLIC_ORIGIN: 'https://example.vercel.app' }

async function start(config: Config) {
  const app = await createApp(config)
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address() as { port: number }
  return { app, url: `http://127.0.0.1:${address.port}` }
}

describe('configuration (checked at startup)', () => {
  it('names the bad fields, never their values', () => {
    expect(() => loadConfig({ APP_ENV: 'staging', PUBLIC_ORIGIN: 'secret-value' })).toThrow(/APP_ENV, PUBLIC_ORIGIN/)
    try {
      loadConfig({ APP_ENV: 'staging', PUBLIC_ORIGIN: 'secret-value' })
    } catch (error) {
      expect(String(error)).not.toContain('secret-value')
    }
  })
  it('refuses the test login outside previews (Security)', () => {
    expect(() => loadConfig({ ...baseEnv, APP_ENV: 'production', AUTH_TEST_PROVIDER: '1' })).toThrow(/AUTH_TEST_PROVIDER/)
    expect(loadConfig({ ...baseEnv, AUTH_TEST_PROVIDER: '1' }).AUTH_TEST_PROVIDER).toBe('1')
  })
  it('reads secrets from the API_SECRETS bundle, never plain settings', () => {
    const json = JSON.stringify({ PROXY_SECRET: SECRET })
    expect(loadConfig({ ...baseEnv, API_SECRETS: json }).PROXY_SECRET).toBe(SECRET)
    expect(() => loadConfig({ ...baseEnv, API_SECRETS: JSON.stringify({ APP_ENV: 'production' }) })).toThrow(/APP_ENV/)
    expect(() => loadConfig({ ...baseEnv, API_SECRETS: JSON.stringify({ PROXY_SECRET: 1 }) })).toThrow(/PROXY_SECRET/)
    expect(() => loadConfig({ ...baseEnv, API_SECRETS: '{"PROXY_SECRET":"secret-value' })).toThrow(/not JSON/)
    try {
      loadConfig({ ...baseEnv, API_SECRETS: '{"PROXY_SECRET":"secret-value' })
    } catch (error) {
      expect(String(error)).not.toContain('secret-value')
    }
  })
  it('rejects a short or malformed proxy secret (Security A-4)', () => {
    for (const bad of ['short', `${SECRET}`, ' '.repeat(40), `${'a'.repeat(39)}=`]) {
      expect(() => loadConfig({ ...baseEnv, PROXY_SECRET: bad })).toThrow(/PROXY_SECRET/)
    }
  })
})

describe('proxy secret comparison', () => {
  it('matches only the exact secret', () => {
    expect(proxySecretMatches(SECRET, SECRET)).toBe(true)
    expect(proxySecretMatches(`${SECRET}x`, SECRET)).toBe(false)
    expect(proxySecretMatches('t'.repeat(40), SECRET)).toBe(false)
    expect(proxySecretMatches(undefined, SECRET)).toBe(false)
    expect(proxySecretMatches(['a'], SECRET)).toBe(false)
  })
  it('fails closed without a usable secret', () => {
    expect(proxySecretMatches('undefined', undefined)).toBe(false)
    expect(proxySecretMatches('', '')).toBe(false)
  })
})

describe('client IP only through the verified proxy (Security)', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request
  const res = (verified: boolean) => ({ locals: { proxyVerified: verified } }) as unknown as Response
  it('ignores headers on unverified requests', () => {
    expect(clientIp(req({ 'x-real-ip': '1.2.3.4' }), res(false))).toBeNull()
  })
  it("uses Vercel's header and never X-Forwarded-For", () => {
    expect(clientIp(req({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }), res(true))).toBe('1.2.3.4')
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }), res(true))).toBeNull()
    expect(clientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9' }), res(true))).toBeNull()
    expect(clientIp(req({ 'x-real-ip': '<script>' }), res(true))).toBeNull()
  })
})

describe('the server', () => {
  let app: INestApplication
  let url: string
  beforeAll(async () => {
    ;({ app, url } = await start(loadConfig({ ...baseEnv, PROXY_SECRET: SECRET })))
  })
  afterAll(() => app.close())
  const proxied = { 'x-proxy-auth': SECRET }

  it('answers /health without the proxy header, saying it was not verified', async () => {
    const res = await fetch(`${url}/api/v1/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, proxyVerified: false })
  })
  it('reports a verified proxy on /health (a boolean only)', async () => {
    const res = await fetch(`${url}/api/v1/health`, { headers: proxied })
    expect(await res.json()).toEqual({ ok: true, proxyVerified: true })
  })
  it('refuses anything else without the proxy header, unknown paths included', async () => {
    for (const path of ['/api/v1/me', '/api/v1/nope', '/']) {
      const res = await fetch(`${url}${path}`)
      expect(res.status).toBe(401)
    }
    const wrong = await fetch(`${url}/api/v1/me`, { headers: { 'x-proxy-auth': 'w'.repeat(40) } })
    expect(wrong.status).toBe(401)
  })
  it('gives a plain JSON 404 through the proxy', async () => {
    const res = await fetch(`${url}/api/v1/nope`, { headers: proxied })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: number; message: string } }
    expect(body.error).toEqual({ message: '찾을 수 없습니다.', code: 404 })
    expect(JSON.stringify(body)).not.toMatch(/stack|at \w+ \(/)
  })
  it('marks every response no-store with the security headers, and hides the framework', async () => {
    for (const res of [await fetch(`${url}/api/v1/health`), await fetch(`${url}/api/v1/me`)]) {
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(res.headers.get('strict-transport-security')).toContain('max-age=')
      expect(res.headers.get('x-powered-by')).toBeNull()
    }
  })
  it('refuses bodies over 64 KB', async () => {
    const res = await fetch(`${url}/api/v1/nope`, {
      method: 'POST',
      headers: { ...proxied, 'content-type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(70_000) }),
    })
    expect(res.status).toBe(413)
  })
})

describe('the server without a proxy secret (fail closed)', () => {
  it('serves only /health', async () => {
    const { app, url } = await start(loadConfig(baseEnv))
    try {
      expect((await fetch(`${url}/api/v1/health`)).status).toBe(200)
      const res = await fetch(`${url}/api/v1/me`, { headers: { 'x-proxy-auth': 'undefined' } })
      expect(res.status).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('malformed requests', () => {
  it('answers broken JSON with 400, not 500', async () => {
    const { app, url } = await start(loadConfig({ ...baseEnv, PROXY_SECRET: SECRET }))
    try {
      const res = await fetch(`${url}/api/v1/nope`, {
        method: 'POST',
        headers: { 'x-proxy-auth': SECRET, 'content-type': 'application/json' },
        body: '{"secret_token_abc": <script>',
      })
      expect(res.status).toBe(400)
      // Fixed text: the parser's message would echo the body (qa Q2-1)
      expect(await res.json()).toEqual({ error: { message: '요청을 처리할 수 없습니다.', code: 400 } })
    } finally {
      await app.close()
    }
  })
})
