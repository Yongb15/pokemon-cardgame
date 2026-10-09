// The signed-in user's own data: decks, favorite cards, nickname, and leaving (schema `account`,
// role api_rw, migrations 0007/0008). Every query is scoped by the session's user id, so another
// user's deck id simply isn't found (404). Inserts name their columns: api_rw may insert only those.

import { MAX_DECKS } from '@card-dex/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { decks, favorites, sessions, users } from '../db/schema.js'
import { planImport, type DeckInput, type DeckRecord, type ImportItem } from './decks.js'

/** Hearted cards per account (design §3) */
export const MAX_FAVORITES = 500

/** Grants these queries need, checked at start-up with the account store's (qa B3-1) */
export const DATA_PRIVILEGES: [string, string | null, string][] = [
  ['decks', null, 'SELECT'],
  ['decks', null, 'DELETE'],
  ['decks', 'user_id', 'INSERT'],
  ['decks', 'source_id', 'INSERT'],
  ['decks', 'name', 'INSERT'],
  ['decks', 'format', 'INSERT'],
  ['decks', 'cards', 'INSERT'],
  ['decks', 'cover_id', 'INSERT'],
  ['decks', 'problems', 'INSERT'],
  ['decks', 'cover_id', 'UPDATE'],
  ['decks', 'problems', 'UPDATE'],
  ['decks', 'name', 'UPDATE'],
  ['decks', 'format', 'UPDATE'],
  ['decks', 'cards', 'UPDATE'],
  ['decks', 'version', 'UPDATE'],
  ['decks', 'updated_at', 'UPDATE'],
  ['favorites', null, 'SELECT'],
  ['favorites', null, 'DELETE'],
  ['favorites', 'user_id', 'INSERT'],
  ['favorites', 'card_id', 'INSERT'],
  ['users', 'nickname', 'UPDATE'],
]

export type SaveResult = DeckRecord | 'not-found' | 'conflict'

export interface ImportResult {
  imported: { sourceId: string; id: string }[]
  duplicates: string[]
  overLimit: string[]
}

export interface UserDataStore {
  listDecks(userId: string): Promise<DeckRecord[]>
  getDeck(userId: string, id: string): Promise<DeckRecord | null>
  /** null when the account already has MAX_DECKS */
  createDeck(userId: string, input: DeckInput): Promise<DeckRecord | null>
  /** Saves only over `version`; an older version is a conflict (another device saved first) */
  updateDeck(userId: string, id: string, input: DeckInput, version: number): Promise<SaveResult>
  deleteDeck(userId: string, id: string): Promise<boolean>
  importDecks(userId: string, items: ImportItem[]): Promise<ImportResult>
  listFavorites(userId: string): Promise<string[]>
  /** false when the account already has MAX_FAVORITES (adding one it has is fine) */
  addFavorite(userId: string, cardId: string): Promise<boolean>
  removeFavorite(userId: string, cardId: string): Promise<void>
  counts(userId: string): Promise<{ decks: number; favorites: number }>
  setNickname(userId: string, nickname: string): Promise<void>
  /** Signs the user out everywhere */
  deleteSessions(userId: string): Promise<void>
  /** The account and everything in it (cascades: sign-in methods, sessions, decks, favorites) */
  deleteUser(userId: string): Promise<void>
}

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]

/**
 * One writer at a time per user for the count-limited inserts, so two requests can't both see 99
 * decks and make 101. A transaction-scoped advisory lock: no table privilege needed, released at
 * commit or rollback.
 */
const lockUser = (tx: Tx, userId: string, what: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${what}:${userId}`}, 0))`)

const deckColumns = {
  id: decks.id,
  name: decks.name,
  format: decks.format,
  cards: decks.cards,
  coverId: decks.coverId,
  problems: decks.problems,
  version: decks.version,
  updatedAt: decks.updatedAt,
}

const toRecord = (row: { id: string; name: string; format: string; cards: unknown; version: number; updatedAt: Date }) =>
  row as DeckRecord

export class PgDataStore implements UserDataStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listDecks(userId: string) {
    const rows = await this.db
      .select(deckColumns)
      .from(decks)
      .where(eq(decks.userId, userId))
      .orderBy(desc(decks.updatedAt), desc(decks.createdAt), decks.id)
    return rows.map(toRecord)
  }

  async getDeck(userId: string, id: string) {
    const [row] = await this.db.select(deckColumns).from(decks).where(and(eq(decks.id, id), eq(decks.userId, userId)))
    return row ? toRecord(row) : null
  }

  async createDeck(userId: string, input: DeckInput) {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId, 'decks')
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(decks).where(eq(decks.userId, userId))) as [{ n: number }]
      if (n >= MAX_DECKS) return null
      const { rows } = await tx.execute<{ id: string; version: number; updated_at: Date }>(
        sql`insert into ${decks} (user_id, name, format, cards, cover_id, problems)
            values (${userId}, ${input.name}, ${input.format}, ${JSON.stringify(input.cards)}::jsonb, ${input.coverId}, ${input.problems})
            returning id, version, updated_at`,
      )
      const row = rows[0]!
      return { ...input, id: row.id, version: row.version, updatedAt: new Date(row.updated_at) }
    })
  }

  async updateDeck(userId: string, id: string, input: DeckInput, version: number): Promise<SaveResult> {
    const [row] = await this.db
      .update(decks)
      .set({
        name: input.name,
        format: input.format,
        cards: input.cards,
        coverId: input.coverId,
        problems: input.problems,
        version: sql`${decks.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(decks.id, id), eq(decks.userId, userId), eq(decks.version, version)))
      .returning(deckColumns)
    if (row) return toRecord(row)
    // Nothing saved: either it isn't this user's deck, or someone saved a newer version first
    return (await this.getDeck(userId, id)) ? 'conflict' : 'not-found'
  }

  async deleteDeck(userId: string, id: string) {
    const rows = await this.db.delete(decks).where(and(eq(decks.id, id), eq(decks.userId, userId))).returning({ id: decks.id })
    return rows.length > 0
  }

  async importDecks(userId: string, items: ImportItem[]): Promise<ImportResult> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId, 'decks')
      const existing = await tx.select({ name: decks.name, sourceId: decks.sourceId }).from(decks).where(eq(decks.userId, userId))
      const plan = planImport(items, {
        sourceIds: new Set(existing.map((d) => d.sourceId).filter((s): s is string => !!s)),
        names: new Set(existing.map((d) => d.name)),
        count: existing.length,
      })
      const imported: ImportResult['imported'] = []
      // Oldest first, so each later insert gets a later clock_timestamp(): the list shows them in the
      // browser's order (qa D5-2). The plan itself is newest first (who gets the free slots).
      for (const deck of [...plan.insert].reverse()) {
        const { rows } = await tx.execute<{ id: string }>(
          sql`insert into ${decks} (user_id, source_id, name, format, cards, cover_id, problems)
              values (${userId}, ${deck.sourceId}, ${deck.name}, ${deck.format}, ${JSON.stringify(deck.cards)}::jsonb, ${deck.coverId}, ${deck.problems})
              returning id`,
        )
        imported.unshift({ sourceId: deck.sourceId, id: rows[0]!.id })
      }
      return { imported, duplicates: plan.duplicates, overLimit: plan.overLimit }
    })
  }

  async listFavorites(userId: string) {
    const rows = await this.db
      .select({ cardId: favorites.cardId })
      .from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt))
    return rows.map((r) => r.cardId)
  }

  async addFavorite(userId: string, cardId: string) {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId, 'favorites')
      const have = await tx
        .select({ cardId: favorites.cardId })
        .from(favorites)
        .where(and(eq(favorites.userId, userId), eq(favorites.cardId, cardId)))
      if (have.length) return true
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(favorites).where(eq(favorites.userId, userId))) as [{ n: number }]
      if (n >= MAX_FAVORITES) return false
      await tx.execute(sql`insert into ${favorites} (user_id, card_id) values (${userId}, ${cardId}) on conflict do nothing`)
      return true
    })
  }

  async removeFavorite(userId: string, cardId: string) {
    await this.db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.cardId, cardId)))
  }

  async counts(userId: string) {
    const { rows } = await this.db.execute<{ decks: number; favorites: number }>(
      sql`select (select count(*)::int from ${decks} where user_id = ${userId}) as decks,
                 (select count(*)::int from ${favorites} where user_id = ${userId}) as favorites`,
    )
    return rows[0] ?? { decks: 0, favorites: 0 }
  }

  async setNickname(userId: string, nickname: string) {
    await this.db.update(users).set({ nickname }).where(eq(users.id, userId))
  }

  async deleteSessions(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId))
  }

  async deleteUser(userId: string) {
    await this.db.delete(users).where(eq(users.id, userId))
  }
}
