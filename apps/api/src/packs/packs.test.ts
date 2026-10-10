import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken, sha256 } from '../auth/crypto.js'
import { createTestProvider } from '../auth/test-provider.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryPacksStore, MemoryPointsStore, MemoryStore } from '../test/memory-store.js'
import { PACK_SETS } from './odds.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const env = { PUBLIC_ORIGIN: ORIGIN, PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: randomToken(32), DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb' }

interface Reply {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function start(appEnv: 'preview' | 'production') {
  const accounts = new MemoryStore()
  const points = new MemoryPointsStore()
  const packs = new MemoryPacksStore(points)
  const config = loadConfig({ ...env, APP_ENV: appEnv, ...(appEnv === 'preview' && { AUTH_TEST_PROVIDER: '1' }) })
  const app: INestApplication = await createApp(config, {
    store: accounts,
    data: new MemoryDataStore(accounts),
    points,
    packs,
    ...(appEnv === 'preview' && { testProvider: await createTestProvider() }),
  })
  await app.listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  let ip = 0
  const headersFor = (cookie?: string) => {
    ip += 1
    const h: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.6.${(ip >> 8) & 255}.${ip & 255}` }
    if (cookie) h.cookie = cookie
    return h
  }
  const call = async (path: string, init: { method?: string; session?: string; body?: unknown } = {}): Promise<Reply> => {
    const headers = headersFor(init.session ? `__Host-session=${init.session}` : undefined)
    const method = init.method ?? 'GET'
    if (method !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), { method, headers, redirect: 'manual', body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  const signIn = async (sub: string) => {
    const hop = (path: string, cookie?: string) => fetch(new URL(path, base), { headers: headersFor(cookie), redirect: 'manual' })
    const s = await hop(`/api/v1/auth/test/start?sub=${sub}`)
    const oauth = /__Host-oauth=([^;]+)/.exec(s.headers.getSetCookie().join(' '))![1]
    const consent = await hop(s.headers.get('location')!)
    const cb = await hop(consent.headers.get('location')!, `__Host-oauth=${oauth}`)
    return /__Host-session=([^;]+)/.exec(cb.headers.getSetCookie().join(' '))![1]!
  }
  return { app, call, signIn, accounts, points, packs }
}

describe('card packs (preview)', () => {
  let t: Awaited<ReturnType<typeof start>>
  beforeAll(async () => {
    t = await start('preview')
  })
  afterAll(() => t.app.close())

  const SET = PACK_SETS[0]!.id

  it('publishes the sets and their odds without a session', async () => {
    const res = await t.call('/api/v1/packs')
    expect(res.status).toBe(200)
    expect(res.body.price).toBe(1000)
    expect(res.body.sets.map((s: { id: string }) => s.id)).toEqual(PACK_SETS.map((s) => s.id))
    expect(res.body.sets[0].odds.reduce((n: number, o: { percent: number }) => n + o.percent, 0)).toBeCloseTo(100, 6)
  })

  it('opens a pack: 1,000P, five cards, idempotent per request id (even with another set)', async () => {
    const session = await t.signIn('opener')
    const first = await t.call('/api/v1/me/packs', { method: 'POST', session, body: { setId: SET, idemKey: 'request-0001' } })
    expect(first.status).toBe(200)
    expect(first.body.kind).toBe('opened')
    expect(first.body.pack.cards).toHaveLength(5)
    expect(first.body.pack.cards[4].rareSlot).toBe(true)
    expect(first.body.points.balance).toBe(9000)
    const again = await t.call('/api/v1/me/packs', { method: 'POST', session, body: { setId: PACK_SETS[1]!.id, idemKey: 'request-0001' } })
    expect(again.body.kind).toBe('repeat')
    expect(again.body.pack.id).toBe(first.body.pack.id)
    expect(again.body.points.balance).toBe(9000)
    expect((await t.call('/api/v1/me/packs/latest', { session })).body.pack.id).toBe(first.body.pack.id)
    expect((await t.call('/api/v1/me/packs/latest?id=x', { session })).status).toBe(400)
  })

  it('refuses when short of points and writes nothing', async () => {
    const session = await t.signIn('short')
    await t.call('/api/v1/test/points', { method: 'POST', session, body: { amount: -9500, idemKey: 'drain-0001' } })
    const before = t.packs.openings.length
    const res = await t.call('/api/v1/me/packs', { method: 'POST', session, body: { setId: SET, idemKey: 'request-0002' } })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('500P 부족')
    expect(t.packs.openings.length).toBe(before)
    expect((await t.call('/api/v1/me/points', { session })).body.balance).toBe(500)
  })

  it('checks inputs strictly', async () => {
    const session = await t.signIn('strict')
    for (const body of [{ setId: 'sv1', idemKey: 'request-0003' }, { setId: SET, idemKey: 'short' }, { setId: SET, idemKey: 'request-0003', x: 1 }, { setId: SET, idemKey: 'request-0003', seed: -1 }]) {
      expect((await t.call('/api/v1/me/packs', { method: 'POST', session, body })).status).toBe(400)
    }
    expect((await t.call('/api/v1/me/collection?set=sv1', { session })).status).toBe(400)
    expect((await t.call('/api/v1/me/collection?page=-1', { session })).status).toBe(400)
    expect((await t.call('/api/v1/me/collection?x=1', { session })).status).toBe(400)
  })

  it('shows the collection grouped by card, with set progress that leaves test copies out', async () => {
    const session = await t.signIn('collector')
    await t.call('/api/v1/me/packs', { method: 'POST', session, body: { setId: SET, idemKey: 'request-0004', seed: 1 } })
    const cardId = PACK_SETS[0]!.tiers.common![0]!
    expect((await t.call('/api/v1/test/cards', { method: 'POST', session, body: { cardId, count: 3 } })).status).toBe(204)
    const list = await t.call(`/api/v1/me/collection?set=${SET}`, { session })
    expect(list.body.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(8)
    expect(list.body.cards.find((c: { cardId: string }) => c.cardId === cardId).test).toBe(3)
    const summary = await t.call('/api/v1/me/collection/summary', { session })
    expect(summary.body.cards).toBe(8)
    const setRow = summary.body.sets.find((s: { id: string }) => s.id === SET)
    expect(setRow.total).toBe(Object.values(PACK_SETS[0]!.tiers).flat().length)
    expect(setRow.owned).toBeLessThanOrEqual(5)
    expect(t.packs.openings.at(-1)!.seeded).toBe(true)
    expect((await t.call('/api/v1/test/pack-check', { session })).body.mine).toEqual({ packs: 1, mismatched: 0 })
  })

  it('test hooks: pool ids only, test accounts only', async () => {
    const session = await t.signIn('hooks')
    expect((await t.call('/api/v1/test/cards', { method: 'POST', session, body: { cardId: 'sv3-125', count: 1 } })).status).toBe(400)
    expect((await t.call('/api/v1/test/cards', { method: 'POST', session, body: { cardId: PACK_SETS[0]!.tiers.rare![0], count: 21 } })).status).toBe(400)
    const real = await t.signIn('realpacks')
    const id = [...t.accounts.accounts.entries()].find(([key]) => key === 'test:realpacks')![1]
    t.accounts.accounts.set('kakao:999', id)
    expect((await t.call('/api/v1/test/cards', { method: 'POST', session: real, body: { cardId: PACK_SETS[0]!.tiers.rare![0], count: 1 } })).status).toBe(403)
    expect((await t.call('/api/v1/me/packs', { method: 'POST', session: real, body: { setId: SET, idemKey: 'request-0005', seed: 3 } })).status).toBe(403)
  })
})

describe('card packs in production', () => {
  it('refuses a seed and has no test routes', async () => {
    const t = await start('production')
    try {
      expect((await t.call('/api/v1/test/cards', { method: 'POST', body: { cardId: 'x', count: 1 } })).status).toBe(404)
      expect((await t.call('/api/v1/test/pack-check')).status).toBe(404)
      expect((await t.call('/api/v1/packs')).status).toBe(200)
      expect((await t.call('/api/v1/me/packs', { method: 'POST', body: { setId: PACK_SETS[0]!.id, idemKey: 'request-0006', seed: 1 } })).status).toBe(401)
      // A real production session: a seed is refused, and without it the pack is not seeded (K-1)
      const userId = await t.accounts.signIn('google', 'prod-user', '트레이너0001')
      const token = randomToken(32)
      await t.accounts.createSession(userId, sha256(token), new Date(Date.now() + 86_400_000))
      const seeded = await t.call('/api/v1/me/packs', { method: 'POST', session: token, body: { setId: PACK_SETS[0]!.id, idemKey: 'request-0007', seed: 1 } })
      expect(seeded.status).toBe(400)
      const plain = await t.call('/api/v1/me/packs', { method: 'POST', session: token, body: { setId: PACK_SETS[0]!.id, idemKey: 'request-0008' } })
      expect(plain.body.kind).toBe('opened')
      expect(t.packs.openings.at(-1)!.seeded).toBe(false)
    } finally {
      await t.app.close()
    }
  })
})
