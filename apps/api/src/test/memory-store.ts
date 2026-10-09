// In-memory AccountStore for tests (not part of the build): the same contract as PgStore, so the
// HTTP flow can be tested end to end without a database. PgStore itself is checked against the dev
// branch (scripts/db-check-api-role.mjs) and on the preview.

import { randomUUID } from 'node:crypto'
import type { Provider } from '../db/schema.js'
import { MAX_DECKS } from '@card-dex/shared'
import { MAX_SESSIONS, type AccountStore, type SessionRecord } from '../auth/store.js'
import { planImport, type DeckInput, type DeckRecord, type ImportItem } from '../data/decks.js'
import { MAX_FAVORITES, type ImportResult, type SaveResult, type UserDataStore } from '../data/store.js'

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
    return { id: d.id, name: d.name, format: d.format, cards: d.cards, version: d.version, updatedAt: d.updatedAt }
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
