// Accounts and sessions in PostgreSQL (schema `account`, role api_rw). Queries go through Drizzle,
// so every value is a bound parameter. Inserts name their columns by hand: api_rw may insert only
// those (migration 0006), and Drizzle's insert() would list every column as DEFAULT.

import { and, desc, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { oauthAccounts, sessions, users, type Provider } from '../db/schema.js'

/** At most this many sessions per user: the oldest go first (Security) */
export const MAX_SESSIONS = 20

export interface SessionRecord {
  userId: string
  nickname: string
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
}

export interface AccountStore {
  /** The user signed in with (provider, subject); created on first sign-in */
  signIn(provider: Provider, subject: string, nickname: string): Promise<string>
  createSession(userId: string, tokenHash: Buffer, expiresAt: Date): Promise<void>
  /** A live session (not expired at `now`) with its user */
  findSession(tokenHash: Buffer, now: Date): Promise<SessionRecord | null>
  extendSession(tokenHash: Buffer, expiresAt: Date, now: Date): Promise<void>
  deleteSession(tokenHash: Buffer): Promise<void>
  providersOf(userId: string): Promise<Provider[]>
  /** True only on the dev branch (it alone has the dev_marker table) */
  isDevDatabase(): Promise<boolean>
}

export class PgStore implements AccountStore {
  constructor(private readonly db: NodePgDatabase) {}

  async signIn(provider: Provider, subject: string, nickname: string) {
    return this.db.transaction(async (tx) => {
      const found = await tx
        .select({ userId: oauthAccounts.userId })
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.subject, subject)))
      if (found[0]) return found[0].userId
      const { rows: created } = await tx.execute<{ id: string }>(
        sql`insert into ${users} (nickname) values (${nickname}) returning id`,
      )
      const userId = created[0]!.id
      const { rows: linked } = await tx.execute<{ user_id: string }>(
        sql`insert into ${oauthAccounts} (provider, subject, user_id) values (${provider}, ${subject}, ${userId})
            on conflict do nothing returning user_id`,
      )
      if (linked[0]) return linked[0].user_id
      // Two first sign-ins at once: the other one won, so drop ours and use theirs
      await tx.delete(users).where(eq(users.id, userId))
      const [winner] = await tx
        .select({ userId: oauthAccounts.userId })
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.subject, subject)))
      if (!winner) throw new Error('account vanished during sign-in')
      return winner.userId
    })
  }

  async createSession(userId: string, tokenHash: Buffer, expiresAt: Date) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`insert into ${sessions} (token_hash, user_id, expires_at) values (${tokenHash}, ${userId}, ${expiresAt})`,
      )
      // Keep the newest MAX_SESSIONS of this user
      const keep = tx
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt))
        .limit(MAX_SESSIONS)
      await tx.delete(sessions).where(and(eq(sessions.userId, userId), notInArray(sessions.tokenHash, keep)))
      // A little housekeeping on each sign-in: expired sessions of anyone, a bounded batch
      const expired = tx
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(lt(sessions.expiresAt, sql`now()`))
        .limit(100)
      await tx.delete(sessions).where(inArray(sessions.tokenHash, expired))
    })
  }

  async findSession(tokenHash: Buffer, now: Date) {
    const [row] = await this.db
      .select({
        userId: sessions.userId,
        nickname: users.nickname,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    return row ?? null
  }

  async extendSession(tokenHash: Buffer, expiresAt: Date, now: Date) {
    await this.db.update(sessions).set({ expiresAt, lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash))
  }

  async deleteSession(tokenHash: Buffer) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  }

  async providersOf(userId: string) {
    const rows = await this.db
      .select({ provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
    return rows.map((r) => r.provider as Provider)
  }

  async isDevDatabase() {
    try {
      await this.db.execute(sql`select 1 from public.dev_marker limit 1`)
      return true
    } catch {
      return false
    }
  }
}
