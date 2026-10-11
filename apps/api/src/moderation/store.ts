// Reports and moderation (docs/auction/moderation.md, Security AD-1..AD-4). Admins come from the owner
// only (api_rw reads the table). Removing an auction takes the auction lock order (§4): the auction row,
// the top bidder's account, the card, then the level-4 writes. No ledger rows: no points changed hands.

import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { lockAccount } from '../points/store.js'
import { aliasOf } from '../auctions/store.js'

export const REPORT_REASONS = ['price_manipulation', 'rmt', 'wrong_item', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const REPORTS_PER_DAY = 10
/** Report notes are cleared this long after the report is resolved (AD-3) */
export const NOTE_KEEP_DAYS = 90

export const MODERATION_PRIVILEGES: [string, string | null, string][] = [
  ['admins', null, 'SELECT'],
  ['auction_reports', null, 'SELECT'],
  ...['user_id', 'auction_id', 'reason', 'note'].map((c): [string, string, string] => ['auction_reports', c, 'INSERT']),
  ...['status', 'resolved_at', 'note'].map((c): [string, string, string] => ['auction_reports', c, 'UPDATE']),
  ['admin_actions', null, 'SELECT'],
  ...['admin_id', 'auction_id', 'action', 'reason'].map((c): [string, string, string] => ['admin_actions', c, 'INSERT']),
]

/** No way for the API to make admins, rewrite reports' facts, or edit the action log (AD-1, AD-4) */
export const MODERATION_EXCESS: [string, string | null, string][] = [
  ['admins', null, 'INSERT'],
  ['admins', null, 'UPDATE'],
  ['admins', null, 'DELETE'],
  ['auction_reports', null, 'DELETE'],
  ['auction_reports', 'user_id', 'UPDATE'],
  ['auction_reports', 'reason', 'UPDATE'],
  ['auction_reports', 'auction_id', 'UPDATE'],
  ['admin_actions', null, 'UPDATE'],
  ['admin_actions', null, 'DELETE'],
]

export type ReportResult = 'ok' | 'repeat' | 'own' | 'not_found' | 'limit'
export type ModerateResult = 'ok' | 'not_found' | 'closed' | 'conflict' | 'nothing'

export interface ReportedAuction {
  id: string
  cardId: string
  status: string
  price: number
  reports: number
  reasons: Partial<Record<ReportReason, number>>
  firstAt: string
}

export interface AdminAuction {
  id: string
  cardId: string
  status: string
  startPrice: number
  topAmount: number | null
  endsAt: string
  bidCount: number
  /** Per-auction alias plus an admin-only stable pseudonym (AD-2); never a user id */
  seller: { pseudonym: string | null }
  bids: { alias: string; pseudonym: string | null; amount: number; at: string }[]
  /** Reporters stay "신고자 n" even here (AD-2) */
  reports: { reporter: string; reason: ReportReason; note: string | null; status: string; at: string }[]
  actions: { action: 'dismiss' | 'remove'; reason: string; at: string }[]
}

export interface ModerationStore {
  isAdmin(userId: string): Promise<boolean>
  report(userId: string, auctionId: string, reason: ReportReason, note: string | null): Promise<ReportResult>
  reported(): Promise<ReportedAuction[]>
  auction(id: string, pseudonym: (userId: string) => string | null): Promise<AdminAuction | null>
  dismiss(adminId: string, auctionId: string, reason: string): Promise<ModerateResult>
  remove(adminId: string, auctionId: string, reason: string): Promise<ModerateResult>
  /** Clears notes of reports resolved more than 90 days ago; returns how many */
  clearOldNotes(): Promise<number>
}

/** "U-" + 10 hex of HMAC-SHA256(user id) with a key of its own (AD-2); null without the key */
export function pseudonymizer(key: Buffer | null) {
  return (userId: string) => (key ? `U-${createHmac('sha256', key).update(userId).digest('hex').slice(0, 10)}` : null)
}

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]
const iso = (d: Date | string) => new Date(d).toISOString()

export class PgModerationStore implements ModerationStore {
  constructor(private readonly db: NodePgDatabase) {}

  async isAdmin(userId: string) {
    const { rows } = await this.db.execute(sql`select 1 from account.admins where user_id = ${userId}`)
    return rows.length > 0
  }

  async report(userId: string, auctionId: string, reason: ReportReason, note: string | null): Promise<ReportResult> {
    return this.db.transaction(async (tx: Tx) => {
      // One writer per user for the daily count (AD-4)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reports:${userId}`}, 0))`)
      const a = await tx.execute<{ seller_id: string | null }>(sql`select seller_id from account.auctions where id = ${auctionId}`)
      if (!a.rows[0]) return 'not_found'
      if (a.rows[0].seller_id === userId) return 'own'
      const prior = await tx.execute(sql`select 1 from account.auction_reports where user_id = ${userId} and auction_id = ${auctionId}`)
      if (prior.rows.length) return 'repeat'
      const today = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from account.auction_reports where user_id = ${userId} and created_at > now() - interval '1 day'`)
      if (today.rows[0]!.n >= REPORTS_PER_DAY) return 'limit'
      await tx.execute(sql`
        insert into account.auction_reports (user_id, auction_id, reason, note) values (${userId}, ${auctionId}, ${reason}, ${note})`)
      return 'ok'
    })
  }

  async reported() {
    const { rows } = await this.db.execute<{ id: string; card_id: string; status: string; price: string; reports: number; reasons: Record<string, number>; first_at: Date }>(sql`
      select a.id, a.card_id, a.status, coalesce(a.top_amount, a.start_price) as price,
             count(*)::int as reports, json_object_agg(r.reason, r.n) as reasons, min(r.first_at) as first_at
      from (select auction_id, reason, count(*)::int as n, min(created_at) as first_at
            from account.auction_reports where status = 'open' group by auction_id, reason) r
      join account.auctions a on a.id = r.auction_id
      group by a.id
      order by min(r.first_at)
      limit 100`)
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      status: r.status,
      price: Number(r.price),
      reports: Object.values(r.reasons).reduce((n, v) => n + v, 0),
      reasons: r.reasons,
      firstAt: iso(r.first_at),
    }))
  }

  async auction(id: string, pseudonym: (userId: string) => string | null) {
    const { rows } = await this.db.execute<{ id: string; card_id: string; status: string; start_price: string; top_amount: string | null; ends_at: Date; bid_count: number; seller_id: string | null }>(sql`
      select id, card_id, status, start_price, top_amount, ends_at, bid_count, seller_id from account.auctions where id = ${id}`)
    const a = rows[0]
    if (!a) return null
    const bids = await this.db.execute<{ bidder_id: string | null; alias_no: number; amount: string; created_at: Date }>(sql`
      select bidder_id, alias_no, amount, created_at from account.bids where auction_id = ${id} order by created_at desc limit 200`)
    const reports = await this.db.execute<{ reason: ReportReason; note: string | null; status: string; created_at: Date }>(sql`
      select reason, note, status, created_at from account.auction_reports where auction_id = ${id} order by created_at`)
    const actions = await this.db.execute<{ action: 'dismiss' | 'remove'; reason: string; created_at: Date }>(sql`
      select action, reason, created_at from account.admin_actions where auction_id = ${id} order by created_at`)
    return {
      id: a.id,
      cardId: a.card_id,
      status: a.status,
      startPrice: Number(a.start_price),
      topAmount: a.top_amount === null ? null : Number(a.top_amount),
      endsAt: iso(a.ends_at),
      bidCount: a.bid_count,
      seller: { pseudonym: a.seller_id ? pseudonym(a.seller_id) : null },
      bids: bids.rows.map((b) => ({ alias: aliasOf(b.alias_no), pseudonym: b.bidder_id ? pseudonym(b.bidder_id) : null, amount: Number(b.amount), at: iso(b.created_at) })),
      reports: reports.rows.map((r, i) => ({ reporter: `신고자 ${i + 1}`, reason: r.reason, note: r.note, status: r.status, at: iso(r.created_at) })),
      actions: actions.rows.map((x) => ({ action: x.action, reason: x.reason, at: iso(x.created_at) })),
    }
  }

  /** The admin sold or bid here: they can't judge it (AD-1) */
  private async conflicted(tx: Tx, adminId: string, auctionId: string) {
    const { rows } = await tx.execute(sql`
      select 1 from account.auctions where id = ${auctionId} and seller_id = ${adminId}
      union all select 1 from account.bids where auction_id = ${auctionId} and bidder_id = ${adminId} limit 1`)
    return rows.length > 0
  }

  async dismiss(adminId: string, auctionId: string, reason: string): Promise<ModerateResult> {
    return this.db.transaction(async (tx: Tx) => {
      const a = await tx.execute(sql`select 1 from account.auctions where id = ${auctionId}`)
      if (!a.rows.length) return 'not_found'
      if (await this.conflicted(tx, adminId, auctionId)) return 'conflict'
      const closed = await tx.execute(sql`
        update account.auction_reports set status = 'dismissed', resolved_at = now()
        where auction_id = ${auctionId} and status = 'open' returning user_id`)
      if (!closed.rows.length) return 'nothing'
      await tx.execute(sql`insert into account.admin_actions (admin_id, auction_id, action, reason) values (${adminId}, ${auctionId}, 'dismiss', ${reason})`)
      return 'ok'
    })
  }

  async remove(adminId: string, auctionId: string, reason: string): Promise<ModerateResult> {
    return this.db.transaction(async (tx: Tx) => {
      // (1) the auction row; open by the database's clock, or it's settlement's turn (AD-4)
      const { rows } = await tx.execute<{ seller_id: string | null; top_bidder_id: string | null; top_amount: string | null; owned_card_id: string | null; card_id: string; open: boolean }>(sql`
        select seller_id, top_bidder_id, top_amount, owned_card_id, card_id, (status = 'open' and now() < ends_at) as open
        from account.auctions where id = ${auctionId} for update`)
      const a = rows[0]
      if (!a) return 'not_found'
      if (!a.open) return 'closed'
      if (await this.conflicted(tx, adminId, auctionId)) return 'conflict'
      // (2) only the current top bid holds points for this auction; outbid ones were released already
      if (a.top_bidder_id && a.top_amount !== null) {
        await lockAccount(tx, a.top_bidder_id)
        await tx.execute(sql`update account.point_accounts set held = held - ${Number(a.top_amount)}, version = version + 1 where user_id = ${a.top_bidder_id}`)
      }
      // (3) the card back to the seller's free cards
      if (a.owned_card_id) await tx.execute(sql`update account.owned_cards set auction_id = null where id = ${a.owned_card_id}`)
      // (4) the auction, reports, the log, and a notice (no reason text) to the seller and top bidder
      await tx.execute(sql`update account.auctions set status = 'cancelled', closed_at = now(), version = version + 1 where id = ${auctionId}`)
      await tx.execute(sql`update account.auction_reports set status = 'actioned', resolved_at = now() where auction_id = ${auctionId} and status = 'open'`)
      await tx.execute(sql`insert into account.admin_actions (admin_id, auction_id, action, reason) values (${adminId}, ${auctionId}, 'remove', ${reason})`)
      for (const userId of [a.seller_id, a.top_bidder_id]) {
        if (!userId) continue
        await tx.execute(sql`
          insert into account.notifications (user_id, kind, auction_id, card_id) values (${userId}, 'removed', ${auctionId}, ${a.card_id})
          on conflict (user_id, auction_id, kind) do nothing`)
      }
      return 'ok'
    })
  }

  async clearOldNotes() {
    const { rows } = await this.db.execute(sql`
      update account.auction_reports set note = null
      where note is not null and status <> 'open' and resolved_at < now() - make_interval(days => ${NOTE_KEEP_DAYS})
      returning user_id`)
    return rows.length
  }
}
