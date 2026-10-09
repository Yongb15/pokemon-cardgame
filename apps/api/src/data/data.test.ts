import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken } from '../auth/crypto.js'
import { createTestProvider } from '../auth/test-provider.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryStore } from '../test/memory-store.js'
import { importedName, planImport, type ImportItem } from './decks.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const config = loadConfig({
  APP_ENV: 'preview',
  PUBLIC_ORIGIN: ORIGIN,
  PROXY_SECRET: SECRET,
  OAUTH_COOKIE_KEY: randomToken(32),
  DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb',
  AUTH_TEST_PROVIDER: '1',
})

interface Reply {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  cookies: string[]
  headers: Headers
}

describe('pure import rules', () => {
  it('suffixes clashing names and keeps them within 50 characters', () => {
    const taken = new Set(['내 덱', '내 덱 (가져옴)', 'a'.repeat(50)])
    expect(importedName('새 덱', taken)).toBe('새 덱')
    expect(importedName('내 덱', taken)).toBe('내 덱 (가져옴 2)')
    const long = importedName('a'.repeat(50), taken)
    expect(long).toBe(`${'a'.repeat(44)} (가져옴)`)
    expect([...long].length).toBe(50)
  })

  it('imports newest first into the free slots and reports the rest', () => {
    const item = (sourceId: string, updatedAt: number): ImportItem => ({ sourceId, updatedAt, name: sourceId, format: 'standard', cards: [] })
    const plan = planImport([item('old', 1), item('dup', 5), item('new', 9)], {
      sourceIds: new Set(['dup']),
      names: new Set(),
      count: 99,
    })
    expect(plan.insert.map((d) => d.sourceId)).toEqual(['new'])
    expect(plan.duplicates).toEqual(['dup'])
    expect(plan.overLimit).toEqual(['old'])
  })
})

describe('user data routes (test sign-in, in-memory store)', () => {
  let app: INestApplication
  let base = ''
  const accounts = new MemoryStore()
  const data = new MemoryDataStore(accounts)
  let ipCount = 0

  beforeAll(async () => {
    app = await createApp(config, { store: accounts, data, testProvider: await createTestProvider() })
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })
  afterAll(() => app.close())

  async function call(path: string, init: { method?: string; session?: string; body?: unknown; origin?: string | null; cookie?: string } = {}): Promise<Reply> {
    ipCount += 1
    const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.9.${(ipCount >> 8) & 255}.${ipCount & 255}` }
    const method = init.method ?? 'GET'
    if (method !== 'GET' && init.origin !== null) headers.origin = init.origin ?? ORIGIN
    const cookie = init.cookie ?? (init.session ? `__Host-session=${init.session}` : undefined)
    if (cookie) headers.cookie = cookie
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), {
      method,
      headers,
      redirect: 'manual',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, cookies: res.headers.getSetCookie(), headers: res.headers }
  }

  /** A fresh session for test user `sub`: start → fake consent → callback */
  async function signIn(sub: string) {
    const hop = async (path: string, cookie?: string) => {
      ipCount += 1
      const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.8.${(ipCount >> 8) & 255}.${ipCount & 255}` }
      if (cookie) headers.cookie = cookie
      return fetch(new URL(path, base), { headers, redirect: 'manual' })
    }
    const start = await hop(`/api/v1/auth/test/start?sub=${sub}`)
    const oauth = /__Host-oauth=([^;]+)/.exec(start.headers.getSetCookie().join(' '))![1]
    const consent = await hop(start.headers.get('location')!)
    const callback = await hop(consent.headers.get('location')!, `__Host-oauth=${oauth}`)
    return /__Host-session=([^;]+)/.exec(callback.headers.getSetCookie().join(' '))![1]!
  }

  const deck = (over: Record<string, unknown> = {}) => ({ name: '리자몽 덱', format: 'standard', cards: [{ id: 'sv3-125', count: 2 }], ...over })

  it('needs a session for every route (401), and an Origin for writes (403)', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/decks'],
      ['POST', '/api/v1/decks'],
      ['GET', '/api/v1/favorites'],
      ['PUT', '/api/v1/favorites/sv1-1'],
      ['GET', '/api/v1/me/summary'],
      ['DELETE', '/api/v1/me'],
    ] as const) {
      const res = await call(path, { method, body: method === 'GET' ? undefined : {} })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(res.body.error.message).toBe('로그인이 필요합니다.')
    }
    const session = await signIn('origin')
    expect((await call('/api/v1/decks', { method: 'POST', session, body: deck(), origin: null })).status).toBe(403)
    expect((await call('/api/v1/decks', { method: 'POST', session, body: deck(), origin: 'https://evil.example' })).status).toBe(403)
  })

  it('creates, lists, reads, saves with the version, and deletes a deck', async () => {
    const session = await signIn('crud')
    const created = await call('/api/v1/decks', { method: 'POST', session, body: deck({ name: '  리자몽‮ 덱 ' }) })
    expect(created.status).toBe(201)
    const { id, version } = created.body.deck
    expect(created.body.deck).toMatchObject({ name: '리자몽 덱', format: 'standard', version: 1 })
    expect(JSON.stringify(created.body)).not.toMatch(/user/i)

    expect((await call('/api/v1/decks', { session })).body.decks.map((d: { id: string }) => d.id)).toEqual([id])
    expect((await call(`/api/v1/decks/${id}`, { session })).body.deck.cards).toEqual([{ id: 'sv3-125', count: 2 }])

    const saved = await call(`/api/v1/decks/${id}`, { method: 'PUT', session, body: { ...deck({ name: '새 이름' }), version } })
    expect(saved.status).toBe(200)
    expect(saved.body.deck).toMatchObject({ name: '새 이름', version: 2 })

    // The same old version again: another device saved first
    const stale = await call(`/api/v1/decks/${id}`, { method: 'PUT', session, body: { ...deck(), version } })
    expect(stale.status).toBe(409)
    expect(stale.body.error.message).toBe('다른 기기에서 이 덱이 바뀌었어요.')

    expect((await call(`/api/v1/decks/${id}`, { method: 'DELETE', session })).status).toBe(204)
    expect((await call(`/api/v1/decks/${id}`, { session })).status).toBe(404)
    expect((await call(`/api/v1/decks/${id}`, { method: 'DELETE', session })).status).toBe(404)
  })

  it("never shows or changes another user's deck (404)", async () => {
    const owner = await signIn('owner')
    const other = await signIn('other')
    const { id } = (await call('/api/v1/decks', { method: 'POST', session: owner, body: deck() })).body.deck
    expect((await call(`/api/v1/decks/${id}`, { session: other })).status).toBe(404)
    expect((await call(`/api/v1/decks/${id}`, { method: 'PUT', session: other, body: { ...deck(), version: 1 } })).status).toBe(404)
    expect((await call(`/api/v1/decks/${id}`, { method: 'DELETE', session: other })).status).toBe(404)
    expect((await call('/api/v1/decks', { session: other })).body.decks).toEqual([])
    expect((await call(`/api/v1/decks/${id}`, { session: owner })).status).toBe(200)
  })

  it('rejects bad decks (400) and bad ids (404)', async () => {
    const session = await signIn('strict')
    const bad = [
      deck({ extra: 1 }),
      deck({ name: '​ ' }),
      deck({ name: 'x'.repeat(201) }),
      deck({ format: 'constructor' }),
      deck({ cards: [{ id: 'sv1-1', count: 1 }, { id: 'sv1-1', count: 1 }] }),
      deck({ cards: [{ id: '<script>', count: 1 }] }),
      deck({ cards: [{ id: 'sv1-1', count: 0 }] }),
      deck({ cards: 'sv1-1' }),
      { name: 'x', format: 'standard' },
      [],
      'text',
    ]
    for (const body of bad) expect((await call('/api/v1/decks', { method: 'POST', session, body })).status, JSON.stringify(body)).toBe(400)
    const { id } = (await call('/api/v1/decks', { method: 'POST', session, body: deck() })).body.deck
    expect((await call(`/api/v1/decks/${id}`, { method: 'PUT', session, body: deck() })).status).toBe(400) // no version
    expect((await call(`/api/v1/decks/${id}`, { method: 'PUT', session, body: { ...deck(), version: 0 } })).status).toBe(400)
    for (const bogus of ['not-a-uuid', '..%2f..%2fme', `${id}x`]) {
      expect((await call(`/api/v1/decks/${bogus}`, { session })).status).toBe(404)
    }
    expect((await call('/api/v1/favorites/bad%20id', { method: 'PUT', session })).status).toBe(404)
  })

  it('stops at 100 decks (422)', async () => {
    const session = await signIn('full')
    const me = [...accounts.accounts].find(([key]) => key === 'test:full')![1]
    for (let i = 0; i < 100; i++) await data.createDeck(me, { name: `덱 ${i}`, format: 'standard', cards: [] })
    const res = await call('/api/v1/decks', { method: 'POST', session, body: deck() })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toBe('덱은 100개까지 저장할 수 있어요.')
  })

  it('imports browser decks once: clashing names, repairs, invalid items, re-import', async () => {
    const session = await signIn('importer')
    await call('/api/v1/decks', { method: 'POST', session, body: deck({ name: '내 덱' }) })
    const browser = [
      { sourceId: 'a1', name: '내 덱', format: 'expanded', cards: [{ id: 'sv1-1', count: 2 }, { id: 'sv1-1', count: 1 }], updatedAt: 2, coverId: 'sv1-1' },
      { sourceId: 'b2', name: '', format: 'weird', cards: [{ id: 'bad id', count: 1 }], updatedAt: 1 },
      { sourceId: 'a1', name: 'same id twice', updatedAt: 3 },
      { name: 'no id' },
      { sourceId: '../x' },
      null,
    ]
    const first = await call('/api/v1/decks/import', { method: 'POST', session, body: { decks: browser } })
    expect(first.status).toBe(200)
    expect(first.body.imported.map((d: { sourceId: string }) => d.sourceId).sort()).toEqual(['a1', 'b2'])
    expect(first.body).toMatchObject({ duplicates: [], overLimit: [], invalid: 3 })
    const names = (await call('/api/v1/decks', { session })).body.decks.map((d: { name: string }) => d.name).sort()
    // a1's later copy ("same id twice") wins; b2 had no usable name
    expect(names).toEqual(['same id twice', '가져온 덱', '내 덱'])
    const again = await call('/api/v1/decks/import', { method: 'POST', session, body: { decks: browser } })
    expect(again.body).toMatchObject({ imported: [], duplicates: expect.arrayContaining(['a1', 'b2']) })
    expect((await call('/api/v1/decks/import', { method: 'POST', session, body: { decks: [], x: 1 } })).status).toBe(400)
    expect((await call('/api/v1/decks/import', { method: 'POST', session, body: { decks: Array(101).fill({}) } })).status).toBe(400)
  })

  it('keeps favorites: idempotent add, list newest first, remove', async () => {
    const session = await signIn('fan')
    for (const id of ['sv1-1', 'sv1-2', 'sv1-1']) expect((await call(`/api/v1/favorites/${id}`, { method: 'PUT', session })).status).toBe(204)
    expect((await call('/api/v1/favorites', { session })).body.cards).toEqual(['sv1-2', 'sv1-1'])
    expect((await call('/api/v1/favorites/sv1-2', { method: 'DELETE', session })).status).toBe(204)
    expect((await call('/api/v1/favorites', { session })).body.cards).toEqual(['sv1-1'])
  })

  it('stops at 500 favorites (422)', async () => {
    const session = await signIn('collector')
    const me = [...accounts.accounts].find(([key]) => key === 'test:collector')![1]
    for (let i = 0; i < 500; i++) await data.addFavorite(me, `sv1-${i}`)
    const res = await call('/api/v1/favorites/sv2-1', { method: 'PUT', session })
    expect(res.status).toBe(422)
    // One it already has is still fine
    expect((await call('/api/v1/favorites/sv1-0', { method: 'PUT', session })).status).toBe(204)
  })

  it('limits writes per user (429 with Retry-After)', async () => {
    const session = await signIn('busy')
    let last: Reply | null = null
    for (let i = 0; i < 61; i++) last = await call(`/api/v1/favorites/sv1-${i}`, { method: 'PUT', session })
    expect(last!.status).toBe(429)
    expect(last!.headers.get('retry-after')).toBe('60')
    // Reading is not limited
    expect((await call('/api/v1/favorites', { session })).status).toBe(200)
  })

  it('renames, signs out everywhere, and leaves with everything deleted', async () => {
    const phone = await signIn('leaver')
    const laptop = await signIn('leaver')
    expect((await call('/api/v1/me', { method: 'PATCH', session: phone, body: { nickname: 'a' } })).status).toBe(400)
    expect((await call('/api/v1/me', { method: 'PATCH', session: phone, body: { nickname: 'x', admin: true } })).status).toBe(400)
    const renamed = await call('/api/v1/me', { method: 'PATCH', session: phone, body: { nickname: ' 피카‮츄 ' } })
    expect(renamed.body.user).toEqual({ nickname: '피카츄', providers: ['test'] })

    await call('/api/v1/decks', { method: 'POST', session: phone, body: deck() })
    await call('/api/v1/favorites/sv1-1', { method: 'PUT', session: phone })
    expect((await call('/api/v1/me/summary', { session: laptop })).body).toEqual({ decks: 1, favorites: 1 })

    const out = await call('/api/v1/me/logout-all', { method: 'POST', session: laptop })
    expect(out.status).toBe(204)
    expect(out.cookies.join('\n')).toMatch(/__Host-session=; Path=\/; Max-Age=0/)
    expect((await call('/api/v1/me', { session: phone })).body).toEqual({ user: null })

    const again = await signIn('leaver')
    const me = [...accounts.accounts].find(([key]) => key === 'test:leaver')![1]
    const left = await call('/api/v1/me', { method: 'DELETE', session: again })
    expect(left.status).toBe(204)
    expect((await call('/api/v1/me', { session: again })).body).toEqual({ user: null })
    expect(accounts.users.has(me)).toBe(false)
    expect(data.decks.some((d) => d.userId === me) || data.favorites.some((f) => f.userId === me)).toBe(false)
    // Signing in again starts a new, empty account
    const fresh = await signIn('leaver')
    expect((await call('/api/v1/me/summary', { session: fresh })).body).toEqual({ decks: 0, favorites: 0 })
  })
})
