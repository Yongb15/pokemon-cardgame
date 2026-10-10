// Auction notifications (docs/auction/design.md §7d). Written inside the bid and settlement transactions
// (after the auction, accounts and card: lock level 4), so a notification exists exactly when what it
// says happened. Rows name only the card and amounts, never another user (A-3).

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Tx } from '../points/store.js'

export type NotificationKind = 'outbid' | 'won' | 'sold' | 'unsold'

/** The newest this many come back; older ones stay but aren't listed */
export const LIST_SIZE = 20

export const NOTIFICATIONS_PRIVILEGES: [string, string | null, string][] = [
  ['notifications', null, 'SELECT'],
  ...['user_id', 'kind', 'auction_id', 'card_id', 'amount'].map((c): [string, string, string] => ['notifications', c, 'INSERT']),
  ...['amount', 'created_at', 'read_at'].map((c): [string, string, string] => ['notifications', c, 'UPDATE']),
]

export const NOTIFICATIONS_EXCESS: [string, string | null, string][] = [
  ['notifications', null, 'DELETE'],
  ['notifications', 'user_id', 'UPDATE'],
  ['notifications', 'kind', 'UPDATE'],
  ['notifications', 'auction_id', 'UPDATE'],
]

/** One per (user, auction, kind): being outbid again brings it back as unread with the new price */
export async function notify(tx: Tx, userId: string, kind: NotificationKind, auctionId: string, cardId: string, amount: number | null) {
  await tx.execute(sql`
    insert into account.notifications (user_id, kind, auction_id, card_id, amount)
    values (${userId}, ${kind}, ${auctionId}, ${cardId}, ${amount})
    on conflict (user_id, auction_id, kind) do update set amount = excluded.amount, created_at = clock_timestamp(), read_at = null`)
}

export interface NotificationItem {
  id: string
  kind: NotificationKind
  auctionId: string
  cardId: string
  amount: number | null
  at: string
  read: boolean
}

export interface NotificationsStore {
  list(userId: string): Promise<{ unread: number; items: NotificationItem[] }>
  /** Marks everything up to now read; returns how many changed */
  markRead(userId: string): Promise<number>
}

export class PgNotificationsStore implements NotificationsStore {
  constructor(private readonly db: NodePgDatabase) {}

  async list(userId: string) {
    const { rows } = await this.db.execute<{ id: string; kind: NotificationKind; auction_id: string; card_id: string; amount: string | null; created_at: Date; read_at: Date | null }>(sql`
      select id, kind, auction_id, card_id, amount, created_at, read_at from account.notifications
      where user_id = ${userId} order by created_at desc, id limit ${LIST_SIZE}`)
    const unread = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from account.notifications where user_id = ${userId} and read_at is null`)
    return {
      unread: unread.rows[0]!.n,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        auctionId: r.auction_id,
        cardId: r.card_id,
        amount: r.amount === null ? null : Number(r.amount),
        at: new Date(r.created_at).toISOString(),
        read: r.read_at !== null,
      })),
    }
  }

  async markRead(userId: string) {
    const { rows } = await this.db.execute(sql`
      update account.notifications set read_at = now() where user_id = ${userId} and read_at is null returning id`)
    return rows.length
  }
}
