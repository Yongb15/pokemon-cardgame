// Price alerts: the price lookup's response checks (Security Q1), and the routes with a fake store and
// fake prices (inputs, unknown cards, the 50 limit, the lazy check on reading notifications).
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken } from '../auth/crypto.js'
import { createTestProvider } from '../auth/test-provider.js'
import { loadConfig } from '../config.js'
import type { NotificationsStore } from '../notifications/store.js'
import { MemoryDataStore, MemoryStore } from '../test/memory-store.js'
import { batchPrices, type PriceFetch } from './prices.js'
import type { AlertsStore, PriceAlert } from './store.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const env = { PUBLIC_ORIGIN: ORIGIN, PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: randomToken(32), DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb' }

const reply = (body: unknown, init: { status?: number; type?: string } = {}) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': init.type ?? 'application/json; charset=utf-8' } })) as unknown as typeof fetch

describe('batch price lookup', () => {
  it('keeps only positive whole won for the ids it asked about', async () => {
    const fetchImpl = reply({ today: '2026-10-11', prices: { 'me5-1': 120, 'me5-2': 0, 'me5-3': 1.5, 'me5-4': '9', other: 5, 'me5-5': 200_000_000 } })
    const out = await batchPrices(ORIGIN, fetchImpl)(['me5-5', 'me5-1', 'me5-2', 'me5-3', 'me5-4'])
    expect(out).toEqual(new Map([['me5-1', 120]]))
  })
  it('treats HTML, a bad date, a redirect error or a 500 as no prices, and 400 as unknown card', async () => {
    expect(await batchPrices(ORIGIN, reply('<html>challenge</html>', { type: 'text/html' }))(['a'])).toBeNull()
    expect(await batchPrices(ORIGIN, reply({ today: 'x', prices: {} }))(['a'])).toBeNull()
    expect(await batchPrices(ORIGIN, reply({ error: 1 }, { status: 500 }))(['a'])).toBeNull()
    expect(await batchPrices(ORIGIN, (async () => Promise.reject(new TypeError('redirect'))) as unknown as typeof fetch)(['a'])).toBeNull()
    expect(await batchPrices(ORIGIN, reply({ error: 1 }, { status: 400 }))(['a'])).toBe('unknown')
  })
  it('asks the fixed host with sorted, unique ids and no cookies', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), init }
      return new Response(JSON.stringify({ today: '2026-10-11', prices: {} }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    await batchPrices(ORIGIN, fetchImpl)(['me5-2', 'me5-1', 'me5-2'])
    expect(seen!.url).toBe(`${ORIGIN}/api/prices/batch?ids=me5-1,me5-2`)
    expect(seen!.init.redirect).toBe('error')
    expect(JSON.stringify(seen!.init.headers)).not.toMatch(/cookie/i)
  })
})

function fakeAlerts(calls: string[]): AlertsStore & { rows: Map<string, PriceAlert> } {
  const rows = new Map<string, PriceAlert>()
  let checked = false
  return {
    rows,
    list: async () => [...rows.values()],
    save: async (_u, cardId, targetKrw) => {
      if (!rows.has(cardId) && rows.size >= 2) return 'limit' // a small limit for the test
      rows.set(cardId, { cardId, targetKrw, active: true, triggeredAt: null })
      return 'saved'
    },
    remove: async (_u, cardId) => rows.delete(cardId),
    claimCheck: async () => {
      if (checked) return []
      checked = true
      return [...rows.values()].filter((r) => r.active).map(({ cardId, targetKrw }) => ({ cardId, targetKrw }))
    },
    fire: async (_u, hits) => (calls.push(`fire ${hits.map((h) => `${h.cardId}@${h.krw}`).join(',')}`), hits.length),
  }
}

const notes: NotificationsStore = { list: async () => ({ unread: 0, items: [] }), markRead: async () => 0 }

describe('price alert routes', () => {
  const calls: string[] = []
  const alerts = fakeAlerts(calls)
  const prices: PriceFetch = async (ids) => (ids.includes('nope-1') ? 'unknown' : new Map(ids.map((id) => [id, 40_000])))
  let app: INestApplication
  let base = ''
  let ip = 0
  const call = async (path: string, init: { method?: string; session?: string; body?: unknown } = {}) => {
    ip += 1
    const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.6.0.${ip}` }
    if (init.session) headers.cookie = `__Host-session=${init.session}`
    if ((init.method ?? 'GET') !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), { method: init.method ?? 'GET', headers, redirect: 'manual', body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const signIn = async (sub: string) => {
    const hop = (path: string, cookie?: string) => {
      ip += 1
      return fetch(new URL(path, base), { headers: { 'x-proxy-auth': SECRET, 'x-real-ip': `10.6.1.${ip}`, ...(cookie && { cookie }) }, redirect: 'manual' })
    }
    const s = await hop(`/api/v1/auth/test/start?sub=${sub}`)
    const oauth = /__Host-oauth=([^;]+)/.exec(s.headers.getSetCookie().join(' '))![1]
    const consent = await hop(s.headers.get('location')!)
    const cb = await hop(consent.headers.get('location')!, `__Host-oauth=${oauth}`)
    return /__Host-session=([^;]+)/.exec(cb.headers.getSetCookie().join(' '))![1]!
  }

  beforeAll(async () => {
    const accounts = new MemoryStore()
    const config = loadConfig({ ...env, APP_ENV: 'preview', AUTH_TEST_PROVIDER: '1' })
    app = await createApp(config, { store: accounts, data: new MemoryDataStore(accounts), notifications: notes, alerts, prices, testProvider: await createTestProvider() })
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })
  afterAll(() => app.close())

  it('saves whole-100 targets for real cards only, up to the limit, and deletes', async () => {
    expect((await call('/api/v1/me/price-alerts')).status).toBe(401)
    const session = await signIn('alerter')
    const ok = await call('/api/v1/me/price-alerts/me5-1', { method: 'PUT', session, body: { targetKrw: 45_000 } })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ alert: { cardId: 'me5-1', targetKrw: 45_000, active: true, triggeredAt: null }, krw: 40_000 })
    for (const body of [{ targetKrw: 45_050 }, { targetKrw: 50 }, { targetKrw: 45_000, x: 1 }, { targetKrw: '45000' }, {}]) {
      expect((await call('/api/v1/me/price-alerts/me5-1', { method: 'PUT', session, body })).status, JSON.stringify(body)).toBe(400)
    }
    expect((await call('/api/v1/me/price-alerts/nope-1', { method: 'PUT', session, body: { targetKrw: 1000 } })).status).toBe(404)
    expect((await call('/api/v1/me/price-alerts/..%2Fx', { method: 'PUT', session, body: { targetKrw: 1000 } })).status).toBe(404)
    expect((await call('/api/v1/me/price-alerts/me5-2', { method: 'PUT', session, body: { targetKrw: 1000 } })).status).toBe(200)
    expect((await call('/api/v1/me/price-alerts/me5-3', { method: 'PUT', session, body: { targetKrw: 1000 } })).status).toBe(422)
    const list = await call('/api/v1/me/price-alerts', { session })
    expect(list.headers.get('cache-control')).toBe('no-store')
    expect(list.body.alerts.map((a: PriceAlert) => a.cardId).sort()).toEqual(['me5-1', 'me5-2'])
    expect((await call('/api/v1/me/price-alerts?x=1', { session })).status).toBe(400)
    expect((await call('/api/v1/me/price-alerts/me5-2', { method: 'DELETE', session })).status).toBe(204)
    expect([...alerts.rows.keys()]).toEqual(['me5-1'])
  })

  it('checks on reading notifications: fires what is at or under the target, once', async () => {
    const session = await signIn('reader')
    calls.length = 0
    await call('/api/v1/me/notifications', { session })
    await call('/api/v1/me/notifications', { session })
    expect(calls).toEqual(['fire me5-1@40000'])
  })
})
