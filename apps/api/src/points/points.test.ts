import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken } from '../auth/crypto.js'
import { createTestProvider } from '../auth/test-provider.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryPointsStore, MemoryStore } from '../test/memory-store.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const env = {
  PUBLIC_ORIGIN: ORIGIN,
  PROXY_SECRET: SECRET,
  OAUTH_COOKIE_KEY: randomToken(32),
  DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb',
}

interface Reply {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

function client(baseOf: () => string) {
  let ip = 0
  const headersFor = (cookie?: string) => {
    ip += 1
    const h: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.7.${(ip >> 8) & 255}.${ip & 255}` }
    if (cookie) h.cookie = cookie
    return h
  }
  async function call(path: string, init: { method?: string; session?: string; body?: unknown } = {}): Promise<Reply> {
    const headers = headersFor(init.session ? `__Host-session=${init.session}` : undefined)
    const method = init.method ?? 'GET'
    if (method !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, baseOf()), { method, headers, redirect: 'manual', body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  async function signIn(sub: string) {
    const hop = (path: string, cookie?: string) => fetch(new URL(path, baseOf()), { headers: headersFor(cookie), redirect: 'manual' })
    const start = await hop(`/api/v1/auth/test/start?sub=${sub}`)
    const oauth = /__Host-oauth=([^;]+)/.exec(start.headers.getSetCookie().join(' '))![1]
    const consent = await hop(start.headers.get('location')!)
    const callback = await hop(consent.headers.get('location')!, `__Host-oauth=${oauth}`)
    return /__Host-session=([^;]+)/.exec(callback.headers.getSetCookie().join(' '))![1]!
  }
  return { call, signIn }
}

describe('points (preview, test sign-in, in-memory store)', () => {
  let app: INestApplication
  let base = ''
  const accounts = new MemoryStore()
  const points = new MemoryPointsStore()
  const { call, signIn } = client(() => base)

  beforeAll(async () => {
    const config = loadConfig({ ...env, APP_ENV: 'preview', AUTH_TEST_PROVIDER: '1' })
    app = await createApp(config, { store: accounts, data: new MemoryDataStore(accounts), points, testProvider: await createTestProvider() })
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })
  afterAll(() => app.close())

  it('needs a session', async () => {
    expect((await call('/api/v1/me/points')).status).toBe(401)
    expect((await call('/api/v1/me/points/daily', { method: 'POST' })).status).toBe(401)
  })

  it('grants the first bonus exactly once, even to two tabs at once', async () => {
    const session = await signIn('bonus')
    const [a, b] = await Promise.all([call('/api/v1/me/points', { session }), call('/api/v1/me/points', { session })])
    expect([a.body.bonusGranted, b.body.bonusGranted].filter(Boolean)).toHaveLength(1)
    const again = await call('/api/v1/me/points', { session })
    expect(again.body).toMatchObject({ balance: 10_000, held: 0, available: 10_000, claimedToday: false, bonusGranted: false })
  })

  it('pays the daily check-in once per Korean day', async () => {
    const session = await signIn('daily')
    const first = await call('/api/v1/me/points/daily', { method: 'POST', session })
    expect(first.body).toMatchObject({ claimed: true, balance: 10_500, claimedToday: true })
    const second = await call('/api/v1/me/points/daily', { method: 'POST', session })
    expect(second.body).toMatchObject({ claimed: false, balance: 10_500 })
    points.today = '2026-10-12'
    expect((await call('/api/v1/me/points/daily', { method: 'POST', session })).body).toMatchObject({ claimed: true, balance: 11_000 })
    points.today = '2026-10-11'
  })

  it('lists the ledger newest first, 20 a page, and refuses a bad cursor', async () => {
    const session = await signIn('ledger')
    await call('/api/v1/me/points', { session })
    for (let i = 0; i < 21; i++) await call('/api/v1/test/points', { method: 'POST', session, body: { amount: 1 + i, idemKey: `topup-${i}-xyz` } })
    const page1 = await call('/api/v1/me/points/entries', { session })
    expect(page1.body.entries).toHaveLength(20)
    expect(page1.body.entries[0]).toMatchObject({ amount: 21, kind: 'admin_adjust' })
    expect(Object.keys(page1.body.entries[0]).sort()).toEqual(['amount', 'createdAt', 'id', 'kind'])
    const page2 = await call(`/api/v1/me/points/entries?before=${encodeURIComponent(page1.body.next)}`, { session })
    expect(page2.body.entries.map((e: { kind: string }) => e.kind)).toEqual(['admin_adjust', 'signup_bonus'])
    expect(page2.body.next).toBeNull()
    expect((await call('/api/v1/me/points/entries?before=nope', { session })).status).toBe(400)
  })

  it('test top-ups: test accounts only, own data, bounded, idempotent, never below held', async () => {
    const session = await signIn('topup')
    const ok = await call('/api/v1/test/points', { method: 'POST', session, body: { amount: 5000, idemKey: 'same-key-1' } })
    expect(ok.body).toMatchObject({ result: 'ok', balance: 15_000 })
    const again = await call('/api/v1/test/points', { method: 'POST', session, body: { amount: 5000, idemKey: 'same-key-1' } })
    expect(again.body).toMatchObject({ result: 'duplicate', balance: 15_000 })
    for (const body of [{ amount: 1_000_001, idemKey: 'too-big-01' }, { amount: 0, idemKey: 'zero-0001' }, { amount: 1.5, idemKey: 'float-001' }, { amount: 5, idemKey: 'x' }]) {
      expect((await call('/api/v1/test/points', { method: 'POST', session, body })).status).toBe(400)
    }
    expect((await call('/api/v1/test/points', { method: 'POST', session, body: { amount: -20_000, idemKey: 'negative-1' } })).status).toBe(422)

    // An account with a real sign-in method is refused, even on a preview (Security T-2)
    const real = await signIn('realuser')
    const id = [...accounts.accounts.entries()].find(([key]) => key === 'test:realuser')![1]
    accounts.accounts.set('google:12345', id)
    expect((await call('/api/v1/test/points', { method: 'POST', session: real, body: { amount: 5, idemKey: 'real-user-1' } })).status).toBe(403)
    expect((await call('/api/v1/test/ledger-check', { session: real })).status).toBe(403)
  })

  it('ledger-check shows my account in detail and only counts for everyone', async () => {
    const session = await signIn('check')
    await call('/api/v1/me/points/daily', { method: 'POST', session })
    const res = await call('/api/v1/test/ledger-check', { session })
    expect(res.body.mine).toEqual({ balance: 10_500, held: 0, ledgerSum: 10_500, ok: true })
    expect(Object.keys(res.body.all).sort()).toEqual(['accounts', 'mismatched', 'overHeld'])
    expect(res.body.all.mismatched).toBe(0)
  })
})

describe('points in production', () => {
  it('has no /test routes at all (404), while the real routes still need a session', async () => {
    const config = loadConfig({ ...env, APP_ENV: 'production' })
    const accounts = new MemoryStore()
    const app = await createApp(config, { store: accounts, data: new MemoryDataStore(accounts), points: new MemoryPointsStore() })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
    const { call } = client(() => base)
    try {
      expect((await call('/api/v1/test/points', { method: 'POST', body: { amount: 5, idemKey: 'prod-check-1' } })).status).toBe(404)
      expect((await call('/api/v1/test/ledger-check')).status).toBe(404)
      expect((await call('/api/v1/me/points')).status).toBe(401)
    } finally {
      await app.close()
    }
  })
})
