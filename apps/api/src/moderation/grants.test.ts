// Admin point grant routes with a fake store (docs/auction/admin-points.md): the admin gate, strict
// bodies, code normalising, the answers for each store result, and where member codes may appear.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { randomToken, sha256 } from '../auth/crypto.js'
import { loadConfig } from '../config.js'
import { MemoryDataStore, MemoryStore } from '../test/memory-store.js'
import type { GrantResult, GrantsStore } from './grants.js'
import type { ModerationStore } from './store.js'

const SECRET = 's'.repeat(40)
const ORIGIN = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const env = { PUBLIC_ORIGIN: ORIGIN, PROXY_SECRET: SECRET, OAUTH_COOKIE_KEY: randomToken(32), DATABASE_URL: 'postgresql://api_rw:x@localhost/neondb', ADMIN_PSEUDONYM_KEY: randomToken(32) }
const CODE = '7F3A9C21'

describe('admin point grant routes', () => {
  const admins = new Set<string>()
  const calls: string[] = []
  let next: GrantResult = { kind: 'ok', grantId: 'g-1', replay: false }
  const grants: GrantsStore = {
    member: async (code) => (code === CODE ? { userId: 'target-user', nickname: '트레이너1786', joinedAt: new Date(0).toISOString() } : null),
    grant: async (_admin, code, amount, reason, idemKey) => (calls.push(`grant ${code} ${amount} ${JSON.stringify(reason)} ${idemKey}`), next),
    recent: async () => [{ id: 'g-1', at: new Date(0).toISOString(), memberCode: CODE, userId: 'target-user', amount: 1000, reason: '이벤트 보상' }],
    clearOldReasons: async () => 0,
  }
  const moderation = { isAdmin: async (u: string) => admins.has(u) } as unknown as ModerationStore
  let app: INestApplication
  let accounts: MemoryStore
  let base = ''
  let ip = 0
  const call = async (path: string, init: { method?: string; session?: string; body?: unknown } = {}) => {
    ip += 1
    const headers: Record<string, string> = { 'x-proxy-auth': SECRET, 'x-real-ip': `10.8.0.${ip % 250}` }
    if (init.session) headers.cookie = `__Host-session=${init.session}`
    if ((init.method ?? 'GET') !== 'GET') headers.origin = ORIGIN
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(new URL(path, base), { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, text }
  }
  const session = async (name: string, ageMs = 0) => {
    const userId = await accounts.signIn('google', name, `트레이너${String(ip).padStart(4, '0')}`)
    const token = randomToken(32)
    await accounts.createSession(userId, sha256(token), new Date(Date.now() + 86_400_000))
    const row = [...accounts.sessions.values()].find((s) => s.userId === userId)!
    row.createdAt = new Date(Date.now() - ageMs)
    row.lastSeenAt = new Date()
    return { userId, token }
  }
  const grant = (token: string | undefined, body: unknown) => call('/api/v1/admin/points/grant', { method: 'POST', session: token, body })
  const good = { code: '7f3a-9c21', amount: 10000, reason: '  이벤트 보상 ', idemKey: 'k-1234567890' }

  beforeAll(async () => {
    accounts = new MemoryStore()
    app = await createApp(loadConfig({ ...env, APP_ENV: 'production' }), { store: accounts, data: new MemoryDataStore(accounts), moderation, grants })
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })
  afterAll(() => app.close())

  it('404 for signed out, non-admins and admins signed in over 12 hours ago', async () => {
    const plain = await session('g-plain')
    const stale = await session('g-stale', 13 * 60 * 60 * 1000)
    admins.add(stale.userId)
    for (const s of [undefined, plain.token, stale.token]) {
      expect((await call(`/api/v1/admin/members/${CODE}`, { session: s })).status).toBe(404)
      expect((await grant(s, good)).status).toBe(404)
      expect((await call('/api/v1/admin/points/grants', { session: s })).status).toBe(404)
    }
  })

  it('looks a member up by code (any spelling), same 404 for malformed and unknown codes', async () => {
    const admin = await session('g-admin-1', 60_000)
    admins.add(admin.userId)
    const found = await call('/api/v1/admin/members/7f3a-9c21', { session: admin.token })
    expect(found.status).toBe(200)
    expect(found.headers.get('cache-control')).toBe('no-store')
    expect(found.body.member).toMatchObject({ code: CODE, nickname: '트레이너1786' })
    expect(found.body.member.pseudonym).toMatch(/^U-[0-9a-f]{10}$/)
    expect(found.text).not.toMatch(/target-user|balance|decks/)
    const unknown = await call('/api/v1/admin/members/00000000', { session: admin.token })
    const malformed = await call('/api/v1/admin/members/zz', { session: admin.token })
    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(malformed.body).toEqual(unknown.body)
  })

  it('grants with a cleaned reason; strict body; each store result has its answer', async () => {
    const admin = await session('g-admin-2', 60_000)
    admins.add(admin.userId)
    next = { kind: 'ok', grantId: 'g-1', replay: false }
    const ok = await grant(admin.token, good)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ result: 'ok', grantId: 'g-1' })
    expect(calls.at(-1)).toBe(`grant ${CODE} 10000 "이벤트 보상" k-1234567890`)
    for (const body of [
      {},
      { ...good, amount: 0 },
      { ...good, amount: 100_001 },
      { ...good, amount: 1.5 },
      { ...good, amount: '100' },
      { ...good, reason: '' },
      { ...good, reason: '​' },
      { ...good, reason: 'x'.repeat(201) },
      { ...good, reason: '문의 user@example.com' },
      { ...good, reason: '연락 010-1234-5678' },
      { ...good, code: 'nope' },
      { ...good, idemKey: 'short' },
      { ...good, idemKey: 'has:colon-123' },
      { ...good, extra: 1 },
    ]) {
      expect((await grant(admin.token, body)).status, JSON.stringify(body)).toBe(400)
    }
    const answers: [GrantResult, number][] = [
      [{ kind: 'not_found' }, 404],
      [{ kind: 'admin_target' }, 403],
      [{ kind: 'limit', usedToday: 495_000 }, 409],
      [{ kind: 'idem_conflict' }, 409],
      [{ kind: 'ok', grantId: 'g-1', replay: true }, 200],
    ]
    for (const [result, status] of answers) {
      next = result
      const res = await grant(admin.token, good)
      expect(res.status, result.kind).toBe(status)
      if (result.kind === 'limit') expect(res.body.error.message).toContain('5,000P')
    }
  })

  it('recent grants carry a pseudonym, never a user id', async () => {
    const admin = await session('g-admin-3', 60_000)
    admins.add(admin.userId)
    const list = await call('/api/v1/admin/points/grants', { session: admin.token })
    expect(list.status).toBe(200)
    expect(list.body.grants[0]).toMatchObject({ memberCode: CODE, amount: 1000, reason: '이벤트 보상' })
    expect(list.body.grants[0].pseudonym).toMatch(/^U-[0-9a-f]{10}$/)
    expect(list.text).not.toMatch(/target-user|userId/)
    expect((await call('/api/v1/admin/points/grants?x=1', { session: admin.token })).status).toBe(400)
  })

  it('/me/summary is the only user-facing place with the member code', async () => {
    const user = await session('g-user')
    const summary = await call('/api/v1/me/summary', { session: user.token })
    expect(summary.body.memberCode).toMatch(/^[0-9A-F]{8}$/)
    const me = await call('/api/v1/me', { session: user.token })
    expect(me.text).not.toMatch(/memberCode|member_code/)
  })
})

// Public, auction and notification answers never carry the member code (A-3): their SQL lists
// columns by name, and only the admin lookup, the grants store and /me/summary may read it
describe('member_code stays out of other queries', () => {
  const src = join(import.meta.dirname, '..')
  // auth/store.ts only names the unique index, to retry a signup on a code collision (I-g1)
  const allowed = new Set(['moderation/grants.ts', 'data/store.ts', 'db/schema.ts', 'test/memory-store.ts', 'auth/store.ts'])
  const files = (dir: string): string[] =>
    readdirSync(join(src, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir, e.name).replaceAll('\\', '/')] : [],
    )
  it('is read only where it belongs', () => {
    const readers = files('.').filter((f) => /member_code|memberCode/.test(readFileSync(join(src, f), 'utf8')))
    expect(readers.filter((f) => !allowed.has(f.replace(/^\.\//, '')) && !f.endsWith('controller.ts'))).toEqual([])
  })
  it('no "select *" or "u.*" from users anywhere', () => {
    for (const f of files('.')) {
      const text = readFileSync(join(src, f), 'utf8')
      expect(text, f).not.toMatch(/select\s+\*\s+from\s+account\.users|\bu\.\*/i)
    }
  })
})
