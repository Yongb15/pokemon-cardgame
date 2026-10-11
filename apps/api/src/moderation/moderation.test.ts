// Reports and admin routes with a fake store (Security AD-1..AD-4): who gets 404, fresh sign-ins only,
// strict bodies, the pseudonym only in admin answers and only with its own key.
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken, sha256 } from '../auth/crypto.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryStore } from '../test/memory-store.js'
import { pseudonymizer, type ModerationStore } from './store.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const KEY = randomToken(32)
const env = { PUBLIC_ORIGIN: ORIGIN, PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: randomToken(32), DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb', ADMIN_PSEUDONYM_KEY: KEY }
const AID = '11111111-2222-4333-8444-555555555555'

describe('admin pseudonyms', () => {
  it('are stable, 10 hex long, and need the key', () => {
    const p = pseudonymizer(Buffer.from(KEY, 'base64url'))
    expect(p('user-1')).toMatch(/^U-[0-9a-f]{10}$/)
    expect(p('user-1')).toBe(p('user-1'))
    expect(p('user-1')).not.toBe(p('user-2'))
    expect(pseudonymizer(null)('user-1')).toBeNull()
  })
  it('the key must be its own', () => {
    expect(() => loadConfig({ ...env, APP_ENV: 'preview', ADMIN_PSEUDONYM_KEY: env.OAUTH_COOKIE_KEY })).toThrow()
    expect(() => loadConfig({ ...env, APP_ENV: 'preview', ADMIN_PSEUDONYM_KEY: 'short' })).toThrow()
  })
})

describe('report and admin routes', () => {
  const calls: string[] = []
  const admins = new Set<string>()
  const fake: ModerationStore = {
    isAdmin: async (u) => admins.has(u),
    report: async (_u, id, reason, note) => (calls.push(`report ${reason} ${JSON.stringify(note)}`), id === AID ? 'ok' : 'not_found'),
    reported: async () => [{ id: AID, cardId: 'me5-1', status: 'open', price: 500, reports: 1, reasons: { rmt: 1 }, firstAt: new Date().toISOString() }],
    auction: async (id, pseudonym) =>
      id === AID
        ? { id, cardId: 'me5-1', status: 'open', startPrice: 100, topAmount: 500, endsAt: new Date().toISOString(), bidCount: 1, seller: { pseudonym: pseudonym('seller') }, bids: [{ alias: '입찰자 A', pseudonym: pseudonym('bidder'), amount: 500, at: new Date().toISOString() }], reports: [], actions: [] }
        : null,
    dismiss: async (_a, id, reason) => (calls.push(`dismiss ${reason}`), id === AID ? 'ok' : 'not_found'),
    remove: async (admin, id, reason) => (calls.push(`remove ${reason}`), admin === 'conflicted' ? 'conflict' : id === AID ? 'ok' : 'not_found'),
    clearOldNotes: async () => 0,
  }
  let app: INestApplication
  let accounts: MemoryStore
  let base = ''
  let ip = 0
  const call = async (path: string, init: { method?: string; session?: string; body?: unknown } = {}) => {
    ip += 1
    const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.7.0.${ip}` }
    if (init.session) headers.cookie = `__Host-session=${init.session}`
    if ((init.method ?? 'GET') !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, text }
  }
  /** A session that signed in `ageMs` ago */
  const session = async (name: string, ageMs = 0) => {
    const userId = await accounts.signIn('google', name, `트레이너${String(ip).padStart(4, '0')}`)
    const token = randomToken(32)
    await accounts.createSession(userId, sha256(token), new Date(Date.now() + 86_400_000))
    const row = [...accounts.sessions.values()].find((s) => s.userId === userId)!
    row.createdAt = new Date(Date.now() - ageMs)
    row.lastSeenAt = new Date()
    return { userId, token }
  }

  beforeAll(async () => {
    accounts = new MemoryStore()
    const config = loadConfig({ ...env, APP_ENV: 'production' })
    app = await createApp(config, { store: accounts, data: new MemoryDataStore(accounts), moderation: fake })
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })
  afterAll(() => app.close())

  it('report: strict body, cleaned note, signed in', async () => {
    const u = await session('reporter')
    expect((await call(`/api/v1/me/auctions/${AID}/report`, { method: 'POST', body: { reason: 'rmt' } })).status).toBe(401)
    const ok = await call(`/api/v1/me/auctions/${AID}/report`, { method: 'POST', session: u.token, body: { reason: 'rmt', note: ' 연락처‮ 남김 \u0007' } })
    expect(ok.status).toBe(201)
    expect(calls.at(-1)).toBe('report rmt "연락처 남김"')
    for (const body of [{ reason: 'spam' }, { reason: 'rmt', x: 1 }, { reason: 'rmt', note: 5 }, { reason: 'rmt', note: 'x'.repeat(201) }, {}]) {
      expect((await call(`/api/v1/me/auctions/${AID}/report`, { method: 'POST', session: u.token, body })).status, JSON.stringify(body)).toBe(400)
    }
    expect((await call('/api/v1/me/auctions/not-a-uuid/report', { method: 'POST', session: u.token, body: { reason: 'rmt' } })).status).toBe(404)
  })

  it('admin routes: 404 for signed out, non-admins and stale admins; works for a fresh admin', async () => {
    const plain = await session('plain')
    const stale = await session('stale', 13 * 60 * 60 * 1000)
    const fresh = await session('fresh', 60 * 1000)
    admins.add(stale.userId)
    admins.add(fresh.userId)
    for (const s of [undefined, plain.token, stale.token]) {
      expect((await call('/api/v1/admin/reports', { session: s })).status).toBe(404)
      expect((await call(`/api/v1/admin/auctions/${AID}/remove`, { method: 'POST', session: s, body: { reason: '조작' } })).status).toBe(404)
    }
    const list = await call('/api/v1/admin/reports', { session: fresh.token })
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    const one = await call(`/api/v1/admin/auctions/${AID}`, { session: fresh.token })
    expect(one.body.auction.bids[0].pseudonym).toMatch(/^U-[0-9a-f]{10}$/)
    expect(one.text).not.toMatch(/seller_?id|bidder_?id|user_?id/i)
    expect((await call(`/api/v1/admin/auctions/${AID}/dismiss`, { method: 'POST', session: fresh.token, body: { reason: '  문제 없음 ' } })).status).toBe(200)
    expect(calls.at(-1)).toBe('dismiss 문제 없음')
    for (const body of [{}, { reason: '' }, { reason: '​' }, { reason: 'x', y: 1 }]) {
      expect((await call(`/api/v1/admin/auctions/${AID}/remove`, { method: 'POST', session: fresh.token, body })).status, JSON.stringify(body)).toBe(400)
    }
    expect((await call(`/api/v1/admin/auctions/${AID}/remove`, { method: 'POST', session: fresh.token, body: { reason: '조작 확인' } })).status).toBe(200)
  })

  it('a conflicted admin gets 409; the pseudonym never shows outside /admin', async () => {
    // The fake treats the user id 'conflicted' as the seller/bidder; reuse its route through a real admin id
    const original = fake.remove
    fake.remove = async () => 'conflict'
    const admin = await session('conflicted-admin', 1000)
    admins.add(admin.userId)
    expect((await call(`/api/v1/admin/auctions/${AID}/remove`, { method: 'POST', session: admin.token, body: { reason: '조작' } })).status).toBe(409)
    fake.remove = original
    const me = await call('/api/v1/me', { session: admin.token })
    expect(me.text).not.toMatch(/U-[0-9a-f]{10}/)
  })
})
