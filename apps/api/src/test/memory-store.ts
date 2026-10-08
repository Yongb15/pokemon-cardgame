// In-memory AccountStore for tests (not part of the build): the same contract as PgStore, so the
// HTTP flow can be tested end to end without a database. PgStore itself is checked against the dev
// branch (scripts/db-check-api-role.mjs) and on the preview.

import { randomUUID } from 'node:crypto'
import type { Provider } from '../db/schema.js'
import { MAX_SESSIONS, type AccountStore, type SessionRecord } from '../auth/store.js'

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
