// In-memory AccountStore for tests (not part of the build): the same contract as PgStore, so the
// HTTP flow can be tested end to end without a database. PgStore itself is checked against the dev
// branch (scripts/db-check-api-role.mjs) and on the preview.

import { randomUUID } from 'node:crypto'
import type { Provider } from '../db/schema.js'
import { MAX_DECKS } from '@card-dex/shared'
import { MAX_SESSIONS, type AccountStore, type SessionRecord } from '../auth/store.js'
import { planImport, type DeckInput, type DeckRecord, type ImportItem } from '../data/decks.js'
import { MAX_FAVORITES, type ImportResult, type SaveResult, type UserDataStore } from '../data/store.js'
import type { PointKind } from '../db/schema.js'
import { drawPack, PACK_PRICE, packSet, type Rng } from '../packs/odds.js'
import { asPackCards, COLLECTION_PAGE, summarize, type CollectionRow, type OpenResult, type PackCheck, type PacksStore } from '../packs/store.js'
import { DAILY_BONUS, ENTRIES_PAGE, FIRST_BONUS, type CreditResult, type LedgerCheck, type PointEntry, type PointsStore, type PointsSummary } from '../points/store.js'

interface Session {
  hash: string
  userId: string
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
}

export class MemoryStore implements AccountStore {
  users = new Map<string, { nickname: string }>()
  accounts = new Map<string, string>()
  sessions: Session[] = []
  dev = true

  async signIn(provider: Provider, subject: string, nickname: string) {
    const key = `${provider}:${subject}`
    const existing = this.accounts.get(key)
    if (existing) return existing
    const id = randomUUID()
    this.users.set(id, { nickname })
    this.accounts.set(key, id)
    return id
  }

  async createSession(userId: string, tokenHash: Buffer, expiresAt: Date) {
    const now = new Date()
    this.sessions.push({ hash: tokenHash.toString('hex'), userId, createdAt: now, expiresAt, lastSeenAt: now })
    const mine = this.sessions.filter((s) => s.userId === userId)
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS)))
    this.sessions = this.sessions.filter((s) => !drop.has(s))
  }

  async findSession(tokenHash: Buffer, now: Date): Promise<SessionRecord | null> {
    const s = this.sessions.find((x) => x.hash === tokenHash.toString('hex') && x.expiresAt > now)
    if (!s) return null
    return { userId: s.userId, nickname: this.users.get(s.userId)!.nickname, createdAt: s.createdAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt }
  }

  async extendSession(tokenHash: Buffer, expiresAt: Date, now: Date) {
    const s = this.sessions.find((x) => x.hash === tokenHash.toString('hex'))
    if (s) Object.assign(s, { expiresAt, lastSeenAt: now })
  }

  async deleteSession(tokenHash: Buffer) {
    this.sessions = this.sessions.filter((s) => s.hash !== tokenHash.toString('hex'))
  }

  async providersOf(userId: string) {
    return [...this.accounts].filter(([, id]) => id === userId).map(([key]) => key.split(':')[0] as Provider)
  }

  async isDevDatabase() {
    return this.dev
  }
}

/** In-memory UserDataStore over a MemoryStore's users and sessions (same contract as PgDataStore) */
export class MemoryDataStore implements UserDataStore {
  decks: (DeckRecord & { userId: string; sourceId: string | null })[] = []
  favorites: { userId: string; cardId: string; at: number }[] = []
  private clock = 0

  constructor(private readonly accounts: MemoryStore) {}

  private mine(userId: string) {
    return this.decks.filter((d) => d.userId === userId)
  }

  private view(d: DeckRecord): DeckRecord {
    return {
      id: d.id,
      name: d.name,
      format: d.format,
      cards: d.cards,
      coverId: d.coverId,
      problems: d.problems,
      version: d.version,
      updatedAt: d.updatedAt,
    }
  }

  /** Strictly increasing times, so "newest first" is well defined within one test */
  private now() {
    this.clock += 1
    return new Date(Date.UTC(2026, 9, 9) + this.clock)
  }

  async listDecks(userId: string) {
    return this.mine(userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((d) => this.view(d))
  }

  async getDeck(userId: string, id: string) {
    const d = this.mine(userId).find((x) => x.id === id)
    return d ? this.view(d) : null
  }

  async createDeck(userId: string, input: DeckInput) {
    if (this.mine(userId).length >= MAX_DECKS) return null
    const deck = { ...input, id: randomUUID(), version: 1, updatedAt: this.now(), userId, sourceId: null }
    this.decks.push(deck)
    return this.view(deck)
  }

  async updateDeck(userId: string, id: string, input: DeckInput, version: number): Promise<SaveResult> {
    const d = this.mine(userId).find((x) => x.id === id)
    if (!d) return 'not-found'
    if (d.version !== version) return 'conflict'
    Object.assign(d, input, { version: d.version + 1, updatedAt: this.now() })
    return this.view(d)
  }

  async deleteDeck(userId: string, id: string) {
    const before = this.decks.length
    this.decks = this.decks.filter((d) => !(d.userId === userId && d.id === id))
    return this.decks.length < before
  }

  async importDecks(userId: string, items: ImportItem[]): Promise<ImportResult> {
    const existing = this.mine(userId)
    const plan = planImport(items, {
      sourceIds: new Set(existing.map((d) => d.sourceId).filter((s): s is string => !!s)),
      names: new Set(existing.map((d) => d.name)),
      count: existing.length,
    })
    // Oldest first, like PgDataStore: later inserts get later times (qa D5-2)
    const imported = [...plan.insert]
      .reverse()
      .map(({ sourceId, ...input }) => {
        const deck = { ...input, id: randomUUID(), version: 1, updatedAt: this.now(), userId, sourceId }
        this.decks.push(deck)
        return { sourceId, id: deck.id }
      })
      .reverse()
    return { imported, duplicates: plan.duplicates, overLimit: plan.overLimit }
  }

  async listFavorites(userId: string) {
    return this.favorites
      .filter((f) => f.userId === userId)
      .sort((a, b) => b.at - a.at)
      .map((f) => f.cardId)
  }

  async addFavorite(userId: string, cardId: string) {
    const mine = this.favorites.filter((f) => f.userId === userId)
    if (mine.some((f) => f.cardId === cardId)) return true
    if (mine.length >= MAX_FAVORITES) return false
    this.favorites.push({ userId, cardId, at: this.now().getTime() })
    return true
  }

  async removeFavorite(userId: string, cardId: string) {
    this.favorites = this.favorites.filter((f) => !(f.userId === userId && f.cardId === cardId))
  }

  async counts(userId: string) {
    return { decks: this.mine(userId).length, favorites: this.favorites.filter((f) => f.userId === userId).length }
  }

  async setNickname(userId: string, nickname: string) {
    this.accounts.users.get(userId)!.nickname = nickname
  }

  async deleteSessions(userId: string) {
    this.accounts.sessions = this.accounts.sessions.filter((s) => s.userId !== userId)
  }

  async deleteUser(userId: string) {
    this.accounts.users.delete(userId)
    for (const [key, id] of this.accounts.accounts) if (id === userId) this.accounts.accounts.delete(key)
    await this.deleteSessions(userId)
    this.decks = this.decks.filter((d) => d.userId !== userId)
    this.favorites = this.favorites.filter((f) => f.userId !== userId)
  }
}

/** In-memory points ledger: the same rules as PgPointsStore (first bonus once, KST day, idem keys) */
export class MemoryPointsStore implements PointsStore {
  entriesOf = new Map<string, PointEntry[]>()
  idem = new Set<string>()
  accounts = new Map<string, { balance: number; held: number }>()
  claims = new Set<string>()
  /** Korea's date; tests can move it */
  today = '2026-10-11'

  ensure(userId: string) {
    let granted = false
    if (!this.accounts.has(userId)) {
      this.accounts.set(userId, { balance: 0, held: 0 })
      granted = this.add(userId, FIRST_BONUS, 'signup_bonus', 'signup') === 'ok'
    }
    return granted
  }

  add(userId: string, amount: number, kind: PointKind, idemKey: string): CreditResult {
    const account = this.accounts.get(userId)!
    if (account.balance + amount < account.held) return 'insufficient'
    if (this.idem.has(`${userId}:${idemKey}`)) return 'duplicate'
    this.idem.add(`${userId}:${idemKey}`)
    const list = this.entriesOf.get(userId) ?? []
    const createdAt = new Date(Date.now() + list.length)
    list.push({ id: randomUUID(), amount, kind, ref: kind === 'admin_adjust' ? 'test' : null, createdAt, at: createdAt.toISOString().replace('Z', '000Z') })
    this.entriesOf.set(userId, list)
    account.balance += amount
    return 'ok'
  }

  private view(userId: string, granted: boolean): PointsSummary {
    const a = this.accounts.get(userId)!
    return { balance: a.balance, held: a.held, available: a.balance - a.held, today: this.today, claimedToday: this.claims.has(`${userId}:${this.today}`), bonusGranted: granted }
  }

  async summary(userId: string) {
    return this.view(userId, this.ensure(userId))
  }

  async claimDaily(userId: string) {
    const granted = this.ensure(userId)
    const key = `${userId}:${this.today}`
    const claimed = !this.claims.has(key)
    if (claimed) {
      this.claims.add(key)
      this.add(userId, DAILY_BONUS, 'daily_bonus', `daily:${this.today}`)
    }
    return { claimed, summary: this.view(userId, granted) }
  }

  async entries(userId: string, before: { at: string; id: string } | null) {
    const all = [...(this.entriesOf.get(userId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    const from = before ? all.findIndex((e) => e.id === before.id) + 1 : 0
    return all.slice(from, from + ENTRIES_PAGE)
  }

  async adjust(userId: string, amount: number, idemKey: string) {
    this.ensure(userId)
    return this.add(userId, amount, 'admin_adjust', idemKey)
  }

  async ledgerCheck(userId: string): Promise<LedgerCheck> {
    const sum = (id: string) => (this.entriesOf.get(id) ?? []).reduce((n, e) => n + e.amount, 0)
    const a = this.accounts.get(userId) ?? { balance: 0, held: 0 }
    const all = [...this.accounts.entries()]
    return {
      mine: { balance: a.balance, held: a.held, ledgerSum: sum(userId), ok: a.balance === sum(userId) },
      all: { accounts: all.length, mismatched: all.filter(([id, x]) => x.balance !== sum(id)).length, overHeld: all.filter(([, x]) => x.held > x.balance).length },
    }
  }
}

/** In-memory packs: shares the points store's balances, same rules as PgPacksStore */
export class MemoryPacksStore implements PacksStore {
  openings: { id: string; userId: string; setId: string; cards: string[]; idemKey: string; seeded: boolean; createdAt: Date }[] = []
  owned: { userId: string; cardId: string; source: 'pack' | 'test'; packId: string | null; at: Date }[] = []

  constructor(private readonly points: MemoryPointsStore) {}

  async open(userId: string, setId: string, idemKey: string, rng?: Rng, seeded = false): Promise<OpenResult> {
    const set = packSet(setId)!
    this.points.ensure(userId)
    const prior = this.openings.find((o) => o.userId === userId && o.idemKey === idemKey)
    if (prior) return { kind: 'repeat', pack: { id: prior.id, setId: prior.setId, cards: asPackCards(prior.setId, prior.cards, null), createdAt: prior.createdAt } }
    const account = this.points.accounts.get(userId)!
    if (account.balance - account.held < PACK_PRICE) return { kind: 'insufficient', available: account.balance - account.held }
    const drawn = drawPack(set, rng)
    const before = new Set(this.owned.filter((o) => o.userId === userId).map((o) => o.cardId))
    const id = randomUUID()
    const createdAt = new Date()
    this.openings.push({ id, userId, setId, cards: drawn.map((c) => c.cardId), idemKey, seeded, createdAt })
    this.points.add(userId, -PACK_PRICE, 'pack_purchase', `pack:${idemKey}`)
    const seen = new Set<string>()
    const cards = drawn.map((c) => {
      const isNew = !before.has(c.cardId) && !seen.has(c.cardId)
      seen.add(c.cardId)
      this.owned.push({ userId, cardId: c.cardId, source: 'pack', packId: id, at: new Date(createdAt.getTime() + this.owned.length) })
      return { ...c, isNew }
    })
    return { kind: 'opened', pack: { id, setId, cards, createdAt } }
  }

  async prior(userId: string, idemKey: string) {
    const p = this.openings.find((o) => o.userId === userId && o.idemKey === idemKey)
    return p ? { id: p.id, setId: p.setId, cards: asPackCards(p.setId, p.cards, null), createdAt: p.createdAt } : null
  }

  async latest(userId: string) {
    const p = this.openings.filter((o) => o.userId === userId).at(-1)
    return p ? { id: p.id, setId: p.setId, cards: asPackCards(p.setId, p.cards, null), createdAt: p.createdAt } : null
  }

  private grouped(userId: string) {
    const map = new Map<string, CollectionRow & { real: number }>()
    for (const o of this.owned.filter((x) => x.userId === userId)) {
      const r = map.get(o.cardId) ?? { cardId: o.cardId, count: 0, test: 0, listed: 0, real: 0, newest: o.at }
      r.count++
      if (o.source === 'test') r.test++
      else r.real++
      if (o.at > r.newest) r.newest = o.at
      map.set(o.cardId, r)
    }
    return [...map.values()]
  }

  async collection(userId: string, setId: string | null, page: number) {
    const all = this.grouped(userId)
      .filter((r) => !setId || r.cardId.startsWith(`${setId}-`))
      .sort((a, b) => b.newest.getTime() - a.newest.getTime() || a.cardId.localeCompare(b.cardId))
    const rows = all.slice(page * COLLECTION_PAGE, page * COLLECTION_PAGE + COLLECTION_PAGE).map((r) => ({ cardId: r.cardId, count: r.count, test: r.test, listed: r.listed, newest: r.newest }))
    return { rows, more: all.length > (page + 1) * COLLECTION_PAGE }
  }

  async summary(userId: string) {
    return summarize(this.grouped(userId))
  }

  async addTestCards(userId: string, cardId: string, count: number) {
    for (let i = 0; i < count; i++) this.owned.push({ userId, cardId, source: 'test', packId: null, at: new Date() })
  }

  async packCheck(userId: string): Promise<PackCheck> {
    const bad = (o: (typeof this.openings)[number]) =>
      [...o.cards].sort().join() !== this.owned.filter((x) => x.packId === o.id).map((x) => x.cardId).sort().join()
    const mine = this.openings.filter((o) => o.userId === userId)
    return { mine: { packs: mine.length, mismatched: mine.filter(bad).length }, all: { packs: this.openings.length, mismatched: this.openings.filter(bad).length } }
  }
}
