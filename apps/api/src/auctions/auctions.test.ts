// Route-level checks for auctions with a recording fake store: inputs, gates, headers, and that no
// response carries a user id. The store's own rules run against Postgres in scripts/db-check-auctions.ts.
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken } from '../auth/crypto.js'
import { createTestProvider } from '../auth/test-provider.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryStore } from '../test/memory-store.js'
import type { NotificationsStore } from '../notifications/store.js'
import { badgeOf, type AuctionPublic, type AuctionsStore } from './store.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const env = { PUBLIC_ORIGIN: ORIGIN, PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: randomToken(32), DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb' }
const AID = '11111111-2222-4333-8444-555555555555'

const state: AuctionPublic = {
  id: AID,
  cardId: 'me5-1',
  status: 'open',
  startPrice: 100,
  minStep: 100,
  minBid: 200,
  topAmount: 100,
  topAlias: '입찰자 A',
  bidCount: 1,
  endsAt: new Date(Date.now() + 60_000).toISOString(),
  extensions: 0,
  maxExtensions: 10,
  version: 3,
  closedAt: null,
  bids: [{ alias: '입찰자 A', amount: 100, at: new Date().toISOString() }],
}

function fakeStore(calls: string[]): AuctionsStore {
  return {
    list: async (_u, cardId, startPrice, minutes) => (calls.push(`list ${cardId} ${startPrice} ${minutes}`), { kind: 'listed', auctionId: AID }),
    bid: async (_u, _id, amount) => (calls.push(`bid ${amount}`), { kind: 'ok', version: 4 }),
    cancel: async () => 'has_bids',
    get: async (id) => (id === AID ? state : null),
    mine: async () => ({ isSeller: false, isTop: true, myAlias: '입찰자 A', held: 100, watching: false }),
    market: async () => ({ items: [{ id: AID, cardId: 'me5-1', price: 100, hasBids: true, bidCount: 1, endsAt: state.endsAt, status: 'open' }], more: false }),
    myAuctions: async () => ({ selling: [], bidding: [], watching: [] }),
    watch: async (_u, id) => (calls.push('watch'), id === AID ? 'ok' : 'not_found'),
    unwatch: async () => void calls.push('unwatch'),
    watchNotices: async () => (calls.push('watch-notices'), 0),
    settleExpired: async () => (calls.push('settle'), 0),
    leave: async () => ({ kind: 'blocked', auctions: [AID] }),
    endsIn: async () => (calls.push('ends-in'), true),
    sweepE2E: async () => (calls.push('sweep'), 0),
    sellerBadge: async (id) => (calls.push('seller-badge'), id === AID ? { badge: 'sold5', newMember: true } : null),
    myBadge: async () => ({ badge: 'first', newMember: false }),
  }
}

function fakeNotifications(calls: string[]): NotificationsStore {
  return {
    list: async () => (calls.push('notes'), { unread: 1, items: [{ id: AID, kind: 'outbid', auctionId: AID, cardId: 'me5-1', amount: 300, target: null, at: new Date().toISOString(), read: false }] }),
    markRead: async () => (calls.push('read'), 1),
  }
}

async function start(appEnv: 'preview' | 'production', calls: string[]) {
  const accounts = new MemoryStore()
  const config = loadConfig({ ...env, APP_ENV: appEnv, ...(appEnv === 'preview' && { AUTH_TEST_PROVIDER: '1' }) })
  const app: INestApplication = await createApp(config, {
    store: accounts,
    data: new MemoryDataStore(accounts),
    auctions: fakeStore(calls),
    notifications: fakeNotifications(calls),
    ...(appEnv === 'preview' && { testProvider: await createTestProvider() }),
  })
  await app.listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  let ip = 0
  const headersFor = (cookie?: string) => {
    ip += 1
    const h: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.5.${(ip >> 8) & 255}.${ip & 255}` }
    if (cookie) h.cookie = cookie
    return h
  }
  const call = async (path: string, init: { method?: string; session?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers = { ...headersFor(init.session ? `__Host-session=${init.session}` : undefined), ...init.headers }
    const method = init.method ?? 'GET'
    if (method !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), { method, headers, redirect: 'manual', body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const signIn = async (sub: string) => {
    const hop = (path: string, cookie?: string) => fetch(new URL(path, base), { headers: headersFor(cookie), redirect: 'manual' })
    const s = await hop(`/api/v1/auth/test/start?sub=${sub}`)
    const oauth = /__Host-oauth=([^;]+)/.exec(s.headers.getSetCookie().join(' '))![1]
    const consent = await hop(s.headers.get('location')!)
    const cb = await hop(consent.headers.get('location')!, `__Host-oauth=${oauth}`)
    return /__Host-session=([^;]+)/.exec(cb.headers.getSetCookie().join(' '))![1]!
  }
  return { app, call, signIn, accounts }
}

describe('auction routes (preview)', () => {
  const calls: string[] = []
  let t: Awaited<ReturnType<typeof start>>
  beforeAll(async () => {
    t = await start('preview', calls)
  })
  afterAll(() => t.app.close())

  it('serves the market and an auction publicly, cached briefly, with an ETag and no user ids', async () => {
    const market = await t.call('/api/v1/auctions?sort=price')
    expect(market.status).toBe(200)
    expect(market.headers.get('cache-control')).toContain('s-maxage=2')
    const one = await t.call(`/api/v1/auctions/${AID}`)
    expect(one.status).toBe(200)
    expect(one.body).not.toHaveProperty('sellerId')
    expect(JSON.stringify(one.body)).not.toMatch(/seller_?id|bidder_?id|nickname/i)
    const etag = one.headers.get('etag')!
    expect((await t.call(`/api/v1/auctions/${AID}`, { headers: { 'if-none-match': etag } })).status).toBe(304)
    expect((await t.call('/api/v1/auctions/not-a-uuid')).status).toBe(404)
    for (const q of ['sort=x', 'set=sv1', 'page=-1', 'x=1']) expect((await t.call(`/api/v1/auctions?${q}`)).status, q).toBe(400)
  })

  it('seller badge: the bucket and new-member flag only, cached 5 minutes, same 404 as the auction', async () => {
    const one = await t.call(`/api/v1/auctions/${AID}/seller`)
    expect(one.status).toBe(200)
    expect(one.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=300')
    // Exactly these keys and no number anywhere (Security B-3)
    expect(one.body).toEqual({ badge: 'sold5', newMember: true })
    expect(Object.values(one.body).some((v) => typeof v === 'number')).toBe(false)
    // Unknown or malformed ids answer like GET /auctions/:id (B-1); no parameters at all (I-1)
    const other = '00000000-0000-4000-8000-000000000000'
    expect((await t.call(`/api/v1/auctions/${other}/seller`)).status).toBe((await t.call(`/api/v1/auctions/${other}`)).status)
    expect((await t.call(`/api/v1/auctions/${other}/seller`)).status).toBe(404)
    expect((await t.call('/api/v1/auctions/not-a-uuid/seller')).status).toBe(404)
    expect((await t.call(`/api/v1/auctions/${AID}/seller?x=1`)).status).toBe(400)
  })

  it('seller badge buckets: distinct buyers 0 / 1-4 / 5-19 / 20+', () => {
    expect([0, 1, 4, 5, 19, 20, 21].map(badgeOf)).toEqual(['first', 'sold1', 'sold1', 'sold5', 'sold5', 'sold20', 'sold20'])
  })

  it('lists with whole-100 prices and known durations (short ones on previews), and bids', async () => {
    const session = await t.signIn('seller')
    expect((await t.call('/api/v1/me/auctions', { method: 'POST', session, body: { cardId: 'me5-1', startPrice: 1000, duration: '2m', idemKey: 'list-key-01' } })).status).toBe(201)
    expect(calls).toContain('list me5-1 1000 2')
    for (const body of [
      { cardId: 'me5-1', startPrice: 150, duration: '1h', idemKey: 'list-key-02' },
      { cardId: 'me5-1', startPrice: 50, duration: '1h', idemKey: 'list-key-03' },
      { cardId: 'me5-1', startPrice: 1000, duration: '9h', idemKey: 'list-key-04' },
      { cardId: 'me5-1', startPrice: 1000, duration: '1h', idemKey: 'list-key-05', x: 1 },
    ]) {
      expect((await t.call('/api/v1/me/auctions', { method: 'POST', session, body })).status, JSON.stringify(body)).toBe(400)
    }
    const bid = await t.call(`/api/v1/me/auctions/${AID}/bids`, { method: 'POST', session, body: { amount: 200, idemKey: 'bid-key-001' } })
    expect(bid.body.result.kind).toBe('ok')
    expect(bid.body.serverNow).toBeTruthy()
    expect((await t.call(`/api/v1/me/auctions/${AID}/bids`, { method: 'POST', session, body: { amount: 250, idemKey: 'bid-key-002' } })).status).toBe(400)
    expect((await t.call(`/api/v1/me/auctions/${AID}/cancel`, { method: 'POST', session })).status).toBe(409)
  })

  it('refuses to delete an account that is still in an open auction', async () => {
    const session = await t.signIn('leaver')
    const me = await t.call('/api/v1/me', { session })
    const res = await t.call('/api/v1/me', { method: 'DELETE', session, body: { confirm: me.body.user.nickname } })
    expect(res.status).toBe(409)
  })

  it('notifications: signed in only, settles the user’s ended auctions first', async () => {
    expect((await t.call('/api/v1/me/notifications')).status).toBe(401)
    const session = await t.signIn('notified')
    calls.length = 0
    const list = await t.call('/api/v1/me/notifications', { session })
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    expect(calls).toEqual(['settle', 'watch-notices', 'notes'])
    expect(list.body.unread).toBe(1)
    expect((await t.call('/api/v1/me/notifications?x=1', { session })).status).toBe(400)
    const read = await t.call('/api/v1/me/notifications/read', { method: 'POST', session })
    expect(read.status).toBe(200)
    expect(read.body).toEqual({ unread: 0 })
    expect((await t.call('/api/v1/me/notifications/read', { method: 'POST', session, body: { x: 1 } })).status).toBe(400)
    expect((await t.call('/api/v1/me/notifications/read', { method: 'POST', session, body: {} })).status).toBe(200)
  })

  it('watch: own setting, writes only, unknown ids 404', async () => {
    const session = await t.signIn('watcher')
    expect((await t.call(`/api/v1/me/auctions/${AID}/watch`, { method: 'PUT' })).status).toBe(401)
    expect((await t.call(`/api/v1/me/auctions/${AID}/watch`, { method: 'PUT', session })).status).toBe(204)
    expect((await t.call('/api/v1/me/auctions/22222222-2222-4222-8222-222222222222/watch', { method: 'PUT', session })).status).toBe(404)
    expect((await t.call('/api/v1/me/auctions/not-a-uuid/watch', { method: 'PUT', session })).status).toBe(404)
    expect((await t.call(`/api/v1/me/auctions/${AID}/watch`, { method: 'DELETE', session })).status).toBe(204)
    const pub = await t.call(`/api/v1/auctions/${AID}`)
    expect(JSON.stringify(pub.body)).not.toMatch(/watch/i)
  })

  it('test hooks: test accounts only', async () => {
    const session = await t.signIn('hooker')
    expect((await t.call(`/api/v1/test/auctions/${AID}/ends-in`, { method: 'POST', session, body: { seconds: 5 } })).status).toBe(204)
    expect((await t.call(`/api/v1/test/auctions/${AID}/ends-in`, { method: 'POST', session, body: { seconds: 601 } })).status).toBe(400)
    const real = await t.signIn('realseller')
    const id = [...t.accounts.accounts.entries()].find(([k]) => k === 'test:realseller')![1]
    t.accounts.accounts.set('google:42', id)
    expect((await t.call('/api/v1/test/auctions/settle', { method: 'POST', session: real })).status).toBe(403)
    // The E2E sweeper (Security E-3): test accounts only, no body, answers a count
    const sweep = await t.call('/api/v1/test/auctions/sweep-e2e', { method: 'POST', session })
    expect(sweep.status).toBe(200)
    expect(sweep.body).toEqual({ deleted: 0 })
    expect(calls).toContain('sweep')
    expect((await t.call('/api/v1/test/auctions/sweep-e2e', { method: 'POST', session, body: { all: true } })).status).toBe(400)
    expect((await t.call('/api/v1/test/auctions/sweep-e2e', { method: 'POST', session: real })).status).toBe(403)
  })
})

describe('auction routes in production', () => {
  it('has no test routes and no short durations', async () => {
    const calls: string[] = []
    const t = await start('production', calls)
    try {
      expect((await t.call('/api/v1/test/auctions/settle', { method: 'POST' })).status).toBe(404)
      expect((await t.call('/api/v1/test/auctions/sweep-e2e', { method: 'POST' })).status).toBe(404)
      const userId = await t.accounts.signIn('google', 'prod-seller', '트레이너0002')
      const token = randomToken(32)
      const { sha256 } = await import('../auth/crypto.js')
      await t.accounts.createSession(userId, sha256(token), new Date(Date.now() + 86_400_000))
      expect((await t.call('/api/v1/me/auctions', { method: 'POST', session: token, body: { cardId: 'me5-1', startPrice: 1000, duration: '2m', idemKey: 'list-key-09' } })).status).toBe(400)
      expect((await t.call('/api/v1/me/auctions', { method: 'POST', session: token, body: { cardId: 'me5-1', startPrice: 1000, duration: '1h', idemKey: 'list-key-10' } })).status).toBe(201)
    } finally {
      await t.app.close()
    }
  })
})
