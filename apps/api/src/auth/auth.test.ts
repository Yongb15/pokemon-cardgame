import type { INestApplication } from '@nestjs/common'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { MemoryStore } from '../test/memory-store.js'
import { pkceChallenge, randomToken, seal, sha256, unseal } from './crypto.js'
import { RateLimiter } from './guards.js'
import { safeNext } from './next.js'
import { googleProvider, kakaoProvider, verifyIdToken } from './providers.js'
import { Sessions } from './sessions.js'
import { createTestProvider } from './test-provider.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const KEY = randomToken(32)
const env = {
  APP_ENV: 'preview',
  PUBLIC_ORIGIN: ORIGIN,
  PROXY_SECRET: SECRET,
  OAUTH_COOKIE_KEY: KEY,
  DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb',
  AUTH_TEST_PROVIDER: '1',
}

describe('next (after sign-in) stays on our site (Security fuzz list)', () => {
  it('keeps plain paths with their query', () => {
    expect(safeNext('/decks?tab=mine', ORIGIN)).toBe('/decks?tab=mine')
    expect(safeNext('/cards/sv6-25', ORIGIN)).toBe('/cards/sv6-25')
  })
  it('turns anything doubtful into /', () => {
    const bad = [
      '//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'https:evil.com', 'evil.com',
      '/\tevil', '/\nx', '', 'javascript:alert(1)', '/api/v1/auth/logout',
      `/${'a'.repeat(200)}`, undefined, ['/decks'], '/\u0000',
      // Dot segments that normalise into "//evil.com" (Security S3-1)
      '/.//evil.com', '/..//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/a/../..//evil.com',
      '/%2E%2E//evil.com', '/./', '/a/.', '/a/..?x', '/.%2e/x',
    ]
    for (const input of bad) expect(safeNext(input, ORIGIN), String(input)).toBe('/')
    // An encoded CRLF stays encoded inside the path: harmless text, not a header
    expect(safeNext('/%0d%0aSet-Cookie:x', ORIGIN)).toBe('/%0d%0aSet-Cookie:x')
  })
})

describe('the sealed oauth cookie', () => {
  const key = Buffer.from(KEY, 'base64url')
  it('opens only with the same key, untouched', () => {
    const sealed = seal({ a: 1 }, key)
    expect(unseal(sealed, key)).toEqual({ a: 1 })
    expect(unseal(sealed, Buffer.from(randomToken(32), 'base64url'))).toBeNull()
    const flipped = Buffer.from(sealed, 'base64url')
    flipped[flipped.length - 1]! ^= 1
    expect(unseal(flipped.toString('base64url'), key)).toBeNull()
    expect(unseal('short', key)).toBeNull()
  })
})

describe('id_token checks (Security: RS256, exact iss/aud/azp, nonce, 60 s skew)', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k' }] })
  const rules = { keys, issuers: ['https://accounts.google.com'], clientId: 'client' }
  const token = (claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string | number } = {}) =>
    new SignJWT({ nonce: 'n', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setSubject('sub-1')
      .setIssuer(opts.iss ?? 'https://accounts.google.com')
      .setAudience(opts.aud ?? 'client')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(privateKey)

  it('accepts a good token and returns its subject', async () => {
    expect(await verifyIdToken(await token(), 'n', rules)).toBe('sub-1')
  })
  it('rejects another issuer, audience, nonce or azp', async () => {
    await expect(verifyIdToken(await token({}, { iss: 'https://evil.example' }), 'n', rules)).rejects.toThrow()
    await expect(verifyIdToken(await token({}, { aud: 'other-client' }), 'n', rules)).rejects.toThrow()
    await expect(verifyIdToken(await token(), 'other-nonce', rules)).rejects.toThrow(/nonce/)
    await expect(verifyIdToken(await token({ azp: 'other-client' }), 'n', rules)).rejects.toThrow(/azp/)
  })
  it('rejects expired tokens beyond the 60 s skew, but not within it', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyIdToken(await token({}, { exp: now - 120 }), 'n', rules)).rejects.toThrow()
    expect(await verifyIdToken(await token({}, { exp: now - 30 }), 'n', rules)).toBe('sub-1')
  })
  it('rejects a token signed with a shared secret (alg confusion) or another key', async () => {
    const hs = await new SignJWT({ nonce: 'n' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('sub-1')
      .setIssuer('https://accounts.google.com')
      .setAudience('client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)))
    await expect(verifyIdToken(hs, 'n', rules)).rejects.toThrow()
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ nonce: 'n' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setSubject('sub-1')
      .setIssuer('https://accounts.google.com')
      .setAudience('client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey)
    await expect(verifyIdToken(forged, 'n', rules)).rejects.toThrow()
  })
  it("never accepts the test provider's tokens as Google's", async () => {
    const test = await createTestProvider()
    const challengeVerifier = randomToken(32)
    const code = await test.issueCode('qa1', 'n', pkceChallenge(challengeVerifier))
    const testToken = await test.exchange(code, challengeVerifier)
    const google = googleProvider(loadConfig({ ...env, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-123' }), keys)
    await expect(google.verify(testToken, 'n')).rejects.toThrow()
    // and a fake code is not an id_token
    await expect(test.verify(code, 'n')).rejects.toThrow()
  })
})

describe("Google's sign-in request", () => {
  it('asks for openid only, with PKCE S256 and the fixed redirect URI', () => {
    const config = loadConfig({ ...env, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-123' })
    const url = new URL(googleProvider(config).authorizeUrl({ state: 's', nonce: 'n', challenge: 'c' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/google/callback`)
    expect(url.searchParams.get('response_type')).toBe('code')
  })
})

const KAKAO_ENV = { KAKAO_CLIENT_ID: '0'.repeat(32), KAKAO_CLIENT_SECRET: 'k'.repeat(32) }

describe("Kakao's sign-in request", () => {
  it('asks for openid only, with PKCE S256 and the fixed redirect URI', () => {
    const url = new URL(kakaoProvider(loadConfig({ ...env, ...KAKAO_ENV })).authorizeUrl({ state: 's', nonce: 'n', challenge: 'c' }))
    expect(url.origin + url.pathname).toBe('https://kauth.kakao.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('0'.repeat(32))
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('nonce')).toBe('n')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/kakao/callback`)
  })
  it("refuses another provider's token, and the other way round", async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k' }] })
    const config = loadConfig({ ...env, ...KAKAO_ENV, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-123' })
    const sign = (iss: string, aud: string) =>
      new SignJWT({ nonce: 'n' }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setSubject('1').setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey)
    const kakao = kakaoProvider(config, keys)
    const google = googleProvider(config, keys)
    expect(await kakao.verify(await sign('https://kauth.kakao.com', '0'.repeat(32)), 'n')).toBe('1')
    await expect(kakao.verify(await sign('https://accounts.google.com', '0'.repeat(32)), 'n')).rejects.toThrow()
    await expect(kakao.verify(await sign('https://kauth.kakao.com', '1-a.apps.googleusercontent.com'), 'n')).rejects.toThrow()
    await expect(google.verify(await sign('https://kauth.kakao.com', '1-a.apps.googleusercontent.com'), 'n')).rejects.toThrow()
  })
  it('turns on only with both values, in the right shape', () => {
    expect(loadConfig({ ...env, ...KAKAO_ENV }).kakaoReady).toBe(true)
    expect(loadConfig({ ...env, KAKAO_CLIENT_ID: '0'.repeat(32) }).kakaoReady).toBe(false)
    expect(() => loadConfig({ ...env, ...KAKAO_ENV, KAKAO_CLIENT_ID: 'not-a-key' })).toThrow(/KAKAO_CLIENT_ID/)
    const bundle = JSON.stringify({ PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: KEY, DATABASE_URL: 'postgresql://a:b@h/db', KAKAO_CLIENT_SECRET: 'k'.repeat(32) })
    expect(loadConfig({ APP_ENV: 'preview', PUBLIC_ORIGIN: ORIGIN, API_SECRETS: bundle, KAKAO_CLIENT_ID: '0'.repeat(32) }).kakaoReady).toBe(true)
  })
})

describe('sessions: 30 days that slide, 90 days at most', () => {
  const DAY = 86_400_000
  it('extends at most once a day and never past 90 days from sign-in', async () => {
    const store = new MemoryStore()
    let now = new Date('2026-01-01T00:00:00Z')
    const sessions = new Sessions(store, () => now)
    const cookies: string[] = []
    const res = { append: (_: string, v: string) => cookies.push(v) } as never
    const userId = await store.signIn('test', 'qa1', '트레이너1')
    await sessions.start({ headers: {} } as never, res, userId)
    const token = /__Host-session=([^;]+)/.exec(cookies[0]!)![1]!
    const req = { headers: { cookie: `__Host-session=${token}` } } as never
    store.sessions[0]!.createdAt = now
    store.sessions[0]!.lastSeenAt = now
    for (let day = 1; day <= 100; day += 1) {
      now = new Date(Date.parse('2026-01-01T00:00:00Z') + day * DAY)
      const user = await sessions.current(req, res)
      if (day < 90) expect(user, `day ${day}`).not.toBeNull()
      else expect(user, `day ${day}`).toBeNull()
    }
  })
  it('keeps at most 20 sessions per user', async () => {
    const store = new MemoryStore()
    const userId = await store.signIn('test', 'qa1', '트레이너1')
    for (let i = 0; i < 25; i += 1) await store.createSession(userId, sha256(String(i)), new Date(Date.now() + DAY))
    expect(store.sessions).toHaveLength(20)
  })
})

describe('rate limits', () => {
  it('allows 30 a minute per key, then refuses until the window resets', () => {
    let now = 0
    const limiter = new RateLimiter(30, 60_000, () => now)
    for (let i = 0; i < 30; i += 1) expect(limiter.allow('ip')).toBe(true)
    expect(limiter.allow('ip')).toBe(false)
    expect(limiter.allow('other-ip')).toBe(true)
    now = 60_000
    expect(limiter.allow('ip')).toBe(true)
  })
  it('puts visitors without a known IP in one much larger bucket (S3-2)', () => {
    const limiter = new RateLimiter(30, 60_000, () => 0)
    const handle = limiter.middleware()
    let passed = 0
    const res = { locals: { proxyVerified: true }, setHeader: () => undefined, status: () => ({ json: () => undefined }) } as never
    for (let i = 0; i < 301; i += 1) handle({ headers: {} } as never, res, () => (passed += 1))
    expect(passed).toBe(300)
    // a known visitor still has their own 30
    let mine = 0
    for (let i = 0; i < 31; i += 1) handle({ headers: { 'x-real-ip': '1.2.3.4' } } as never, res, () => (mine += 1))
    expect(mine).toBe(30)
  })
})

describe('configuration for sign-in', () => {
  it('refuses a half-configured sign-in', () => {
    expect(() => loadConfig({ ...env, OAUTH_COOKIE_KEY: undefined })).toThrow(/OAUTH_COOKIE_KEY/)
    expect(() => loadConfig({ ...env, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...env, AUTH_TEST_PROVIDER: '0', GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-123', DATABASE_URL: undefined })).toThrow()
  })
  it('accepts the new secrets only from the bundle keys it knows', () => {
    const bundle = JSON.stringify({ PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: KEY, DATABASE_URL: 'postgresql://a:b@h/db', GOOGLE_CLIENT_SECRET: 'secret-123' })
    const config = loadConfig({ APP_ENV: 'preview', PUBLIC_ORIGIN: ORIGIN, API_SECRETS: bundle, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com' })
    expect(config.googleReady).toBe(true)
    expect(() => loadConfig({ ...env, DATABASE_URL: 'https://not-a-database' })).toThrow(/DATABASE_URL/)
  })
})

// ---- the whole flow over HTTP, with the test provider and an in-memory store ----

interface Hop {
  status: number
  location: string | null
  cookies: Record<string, string>
  raw: string[]
  body: string
}

function cookiesOf(res: Response) {
  const out: Record<string, string> = {}
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair!.indexOf('=')
    out[pair!.slice(0, eq)] = pair!.slice(eq + 1)
  }
  return out
}

async function startServer(config: Config, store: MemoryStore, withTest = true) {
  const app = await createApp(config, { store, testProvider: withTest ? await createTestProvider() : null })
  await app.listen(0, '127.0.0.1')
  const { port } = app.getHttpServer().address() as { port: number }
  const base = `http://127.0.0.1:${port}`
  let calls = 0
  const call = async (path: string, init: { method?: string; cookie?: string; origin?: string } = {}): Promise<Hop> => {
    // A different visitor IP per call, so the sign-in rate limit (tested on its own) stays out of the way
    const ip = `10.${(calls >> 8) & 255}.${calls & 255}.1`
    calls += 1
    const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': ip }
    if (init.cookie) headers.cookie = init.cookie
    if (init.origin) headers.origin = init.origin
    const res = await fetch(new URL(path, base), { method: init.method ?? 'GET', headers, redirect: 'manual' })
    return {
      status: res.status,
      location: res.headers.get('location'),
      cookies: cookiesOf(res),
      raw: res.headers.getSetCookie(),
      body: await res.text(),
    }
  }
  return { app, call }
}

describe('sign-in flow (test provider, preview)', () => {
  let app: INestApplication
  let call: Awaited<ReturnType<typeof startServer>>['call']
  const store = new MemoryStore()
  beforeAll(async () => {
    ;({ app, call } = await startServer(loadConfig(env), store))
  })
  afterAll(() => app.close())

  /** start → fake consent → callback; returns the callback hop and the oauth cookie it used */
  async function signIn(sub = 'qa1', next = '/decks') {
    const start = await call(`/api/v1/auth/test/start?sub=${sub}&next=${encodeURIComponent(next)}`)
    expect(start.status).toBe(302)
    const oauth = start.cookies['__Host-oauth']!
    const consent = await call(start.location!)
    expect(consent.status).toBe(302)
    const callback = await call(consent.location!, { cookie: `__Host-oauth=${oauth}` })
    return { start, consent, callback, oauth }
  }

  it('signs in, sets a session cookie and lands on next', async () => {
    const { start, callback } = await signIn()
    expect(start.location).toMatch(/^\/api\/v1\/auth\/test\/authorize\?/)
    expect(callback.status).toBe(302)
    expect(callback.location).toBe('/decks')
    expect(callback.cookies['__Host-oauth']).toBe('') // single use: cleared
    const session = callback.cookies['__Host-session']!
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const me = await call('/api/v1/me', { cookie: `__Host-session=${session}` })
    const body = JSON.parse(me.body) as { user: { nickname: string; providers: string[] } }
    expect(body.user.providers).toEqual(['test'])
    expect(body.user.nickname).toMatch(/^트레이너\d{4}$/)
    expect(me.body).not.toMatch(/userId|"id"/)
  })

  it('sets both cookies as __Host- with HttpOnly, Secure, SameSite=Lax and Path=/', async () => {
    const { start, callback } = await signIn('qa2')
    const lines = [...start.raw, ...callback.raw].filter((l) => l.startsWith('__Host-') && !/^__Host-oauth=;/.test(l))
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).toMatch(/; Path=\/;/)
      expect(line).toMatch(/; HttpOnly; Secure; SameSite=Lax$/)
      expect(line).not.toMatch(/Domain=/i)
    }
    expect(start.raw.find((l) => l.startsWith('__Host-oauth='))).toMatch(/Max-Age=600;/)
    expect(callback.raw.find((l) => l.startsWith('__Host-session='))).toMatch(/Max-Age=2592000;/)
  })

  it('the same user signs in to the same account', async () => {
    const before = store.users.size
    await signIn('same-user')
    await signIn('same-user')
    expect(store.users.size).toBe(before + 1)
  })

  it('refuses a replayed oauth cookie, a wrong state or a missing cookie', async () => {
    const { consent, oauth } = await signIn('qa3')
    // The same callback again (cookie and code replayed): its session is not created again
    const replay = await call(consent.location!, { cookie: `__Host-oauth=${oauth}` })
    expect(replay.location).toBe('/login?error=failed')
    const start = await call('/api/v1/auth/test/start?sub=qa3')
    const c2 = await call(start.location!)
    const wrongState = c2.location!.replace(/state=[^&]+/, 'state=wrong')
    expect((await call(wrongState, { cookie: `__Host-oauth=${start.cookies['__Host-oauth']}` })).location).toBe('/login?error=expired')
    expect((await call(c2.location!)).location).toBe('/login?error=expired')
  })

  it('turns a refused consent into a fixed reason, never the provider text', async () => {
    const start = await call('/api/v1/auth/test/start?sub=qa4')
    const state = new URL(start.location!, 'http://x').searchParams.get('state')!
    const hop = await call(`/api/v1/auth/test/callback?error=access_denied&error_description=%3Cscript%3E&state=${state}`, {
      cookie: `__Host-oauth=${start.cookies['__Host-oauth']}`,
    })
    expect(hop.location).toBe('/login?error=cancelled')
  })

  it("refuses another provider's oauth cookie", async () => {
    const forged = seal({ p: 'google', s: 'st', n: 'n', v: 'v', next: '/', exp: Date.now() / 1000 + 60 }, Buffer.from(KEY, 'base64url'))
    const hop = await call('/api/v1/auth/test/callback?code=x&state=st', { cookie: `__Host-oauth=${forged}` })
    expect(hop.location).toBe('/login?error=expired')
  })

  it('sends a dangerous next to /', async () => {
    for (const next of ['//evil.com/x', '/.//evil.com', '/a/..//evil.com', '/%2e//evil.com']) {
      const { callback } = await signIn('qa5', next)
      expect(callback.location, next).toBe('/')
    }
  })

  it('checks next again right before the redirect, whatever the cookie says (S3-1)', async () => {
    const start = await call('/api/v1/auth/test/start?sub=qa7')
    const consent = await call(start.location!)
    const state = new URL(consent.location!, 'http://x').searchParams.get('state')!
    const opened = unseal(start.cookies['__Host-oauth']!, Buffer.from(KEY, 'base64url')) as Record<string, unknown>
    const forged = seal({ ...opened, s: state, next: '//evil.com' }, Buffer.from(KEY, 'base64url'))
    const hop = await call(consent.location!, { cookie: `__Host-oauth=${forged}` })
    expect(hop.location).toBe('/')
  })

  it('ends the previous session of this browser on a new sign-in (I3-2)', async () => {
    const first = await signIn('qa8')
    const old = first.callback.cookies['__Host-session']!
    const start = await call('/api/v1/auth/test/start?sub=qa8')
    const consent = await call(start.location!)
    const again = await call(consent.location!, { cookie: `__Host-oauth=${start.cookies['__Host-oauth']}; __Host-session=${old}` })
    expect(again.cookies['__Host-session']).not.toBe(old)
    expect(JSON.parse((await call('/api/v1/me', { cookie: `__Host-session=${old}` })).body)).toEqual({ user: null })
  })

  it('only accepts test account names it knows the shape of', async () => {
    expect((await call('/api/v1/auth/test/start?sub=Admin@google')).location).toBe('/login?error=failed')
    expect((await call('/api/v1/auth/test/start')).location).toBe('/login?error=failed')
  })

  it('logs out with POST from our origin only, and the token is dead afterwards', async () => {
    const { callback } = await signIn('qa6')
    const cookie = `__Host-session=${callback.cookies['__Host-session']}`
    expect((await call('/api/v1/auth/logout', { method: 'POST', cookie })).status).toBe(403)
    expect((await call('/api/v1/auth/logout', { method: 'POST', cookie, origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/api/v1/auth/logout', { method: 'POST', cookie, origin: 'https://pokemon-card-dex-evil.vercel.app' })).status).toBe(403)
    expect((await call('/api/v1/auth/logout', { method: 'GET', cookie })).status).toBe(404)
    const out = await call('/api/v1/auth/logout', { method: 'POST', cookie, origin: ORIGIN })
    expect(out.status).toBe(204)
    expect(out.cookies['__Host-session']).toBe('')
    const me = await call('/api/v1/me', { cookie })
    expect(JSON.parse(me.body)).toEqual({ user: null })
  })

  it("accepts this project's other previews as an origin", async () => {
    const out = await call('/api/v1/auth/logout', { method: 'POST', origin: 'https://pokemon-card-dex-git-feature-x-dydqls-projects.vercel.app' })
    expect(out.status).toBe(204)
  })

  it('answers /me with user null for a forged or unknown session, and clears it', async () => {
    const me = await call('/api/v1/me', { cookie: `__Host-session=${randomToken(32)}` })
    expect(JSON.parse(me.body)).toEqual({ user: null })
    expect(me.cookies['__Host-session']).toBe('')
  })

  it('never caches sign-in answers', async () => {
    const res = await fetch(new URL('/api/v1/me', `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`), {
      headers: { 'x-proxy-auth': SECRET },
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('production', () => {
  it('has no test sign-in routes, even if a test provider were handed in', async () => {
    const config = loadConfig({ ...env, APP_ENV: 'production', AUTH_TEST_PROVIDER: '0', PUBLIC_ORIGIN: 'https://pokemon-card-dex-green.vercel.app' })
    const { app, call } = await startServer(config, new MemoryStore(), true)
    try {
      expect((await call('/api/v1/auth/test/start?sub=qa1')).status).toBe(404)
      expect((await call('/api/v1/auth/test/authorize?state=a&nonce=b&code_challenge=c&sub=qa1')).status).toBe(404)
      expect((await call('/api/v1/auth/test/callback?code=a&state=b')).status).toBe(404)
      // and Google and Kakao are off until configured
      expect((await call('/api/v1/auth/google/start')).status).toBe(404)
      expect((await call('/api/v1/auth/kakao/start')).status).toBe(404)
      // previews are not allowed origins in production
      const out = await call('/api/v1/auth/logout', { method: 'POST', origin: 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app' })
      expect(out.status).toBe(403)
    } finally {
      await app.close()
    }
  })
})
