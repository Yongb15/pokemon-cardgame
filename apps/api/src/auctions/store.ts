// Auctions (docs/auction/design.md §2–§4, ADR 0005). Every write is one transaction in the global
// lock order — (1) the auction row, (2) point accounts by user id, (3) card rows — and every "is it
// over yet" uses the database's clock (A-1). Bids reserve points in point_accounts.held; only a
// settlement writes the ledger (purchase / sale_income / sale_fee) and moves the card.
// Responses never carry a user id: the seller is "판매자", bidders are per-auction letters (A-3 gate).

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { credit, lockAccount, type Tx } from '../points/store.js'

export const MIN_STEP = 100
export const MIN_START = 100
export const MAX_PRICE = 100_000_000
export const MAX_OPEN_PER_SELLER = 10
/** A bid this close to the end pushes it back by the same amount, at most this many times */
export const EXTEND_SECONDS = 120
export const MAX_EXTENSIONS = 10
export const FEE_PERCENT = 5
/** Listing lengths in minutes; previews also offer short ones for testing (Security T-1) */
export const DURATIONS: Record<string, number> = { '1h': 60, '24h': 1440, '72h': 4320 }
export const TEST_DURATIONS: Record<string, number> = { '2m': 2, '5m': 5 }

export const fee = (price: number) => Math.floor((price * FEE_PERCENT) / 100)

export const AUCTIONS_PRIVILEGES: [string, string | null, string][] = [
  ['auctions', null, 'SELECT'],
  ...['seller_id', 'owned_card_id', 'card_id', 'start_price', 'min_step', 'ends_at', 'original_ends_at', 'idem_key'].map((c): [string, string, string] => ['auctions', c, 'INSERT']),
  ...['status', 'ends_at', 'extensions', 'top_amount', 'top_bidder_id', 'bid_count', 'version', 'closed_at'].map((c): [string, string, string] => ['auctions', c, 'UPDATE']),
  ['bids', null, 'SELECT'],
  ...['auction_id', 'bidder_id', 'amount', 'alias_no', 'idem_key'].map((c): [string, string, string] => ['bids', c, 'INSERT']),
  ['owned_cards', 'user_id', 'UPDATE'],
  ['owned_cards', 'auction_id', 'UPDATE'],
]

export const AUCTIONS_EXCESS: [string, string | null, string][] = [
  ['auctions', null, 'DELETE'],
  ['auctions', 'seller_id', 'UPDATE'],
  ['auctions', 'card_id', 'UPDATE'],
  ['auctions', 'start_price', 'UPDATE'],
  ['bids', null, 'UPDATE'],
  ['bids', null, 'DELETE'],
]

/** 1 → A, 26 → Z, 27 → AA */
export function aliasOf(n: number) {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return `입찰자 ${s}`
}

type AuctionRow = {
  id: string
  seller_id: string | null
  owned_card_id: string | null
  card_id: string
  start_price: string
  min_step: string
  status: 'open' | 'sold' | 'unsold' | 'cancelled'
  ends_at: Date
  extensions: number
  top_amount: string | null
  top_bidder_id: string | null
  bid_count: number
  version: number
  closed_at: Date | null
  expired: boolean
}

/** What anyone may see of an auction (no user ids) */
export interface AuctionPublic {
  id: string
  cardId: string
  status: AuctionRow['status'] | 'ending'
  startPrice: number
  minStep: number
  /** The least the next bid can be */
  minBid: number
  topAmount: number | null
  topAlias: string | null
  bidCount: number
  endsAt: string
  extensions: number
  maxExtensions: number
  version: number
  closedAt: string | null
  bids: { alias: string; amount: number; at: string }[]
}

/** The same auction from one signed-in viewer's side */
export interface AuctionMine {
  isSeller: boolean
  isTop: boolean
  /** Their own alias here, if they bid */
  myAlias: string | null
  /** What their current top bid holds */
  held: number
}

export type ListResult = { kind: 'listed' | 'repeat'; auctionId: string } | { kind: 'no_card' | 'limit' }
export type BidResult =
  | { kind: 'ok' | 'repeat'; version: number }
  | { kind: 'not_found' | 'closed' | 'ended' | 'own' }
  | { kind: 'too_low'; minBid: number }
  | { kind: 'insufficient'; available: number; need: number }
export type CancelResult = 'ok' | 'not_found' | 'has_bids' | 'closed'
export type LeaveResult = { kind: 'deleted' } | { kind: 'blocked'; auctions: string[] }

export interface MarketItem {
  id: string
  cardId: string
  price: number
  hasBids: boolean
  bidCount: number
  endsAt: string
  status: AuctionPublic['status']
}

export interface AuctionsStore {
  list(userId: string, cardId: string, startPrice: number, minutes: number, idemKey: string): Promise<ListResult>
  bid(userId: string, auctionId: string, amount: number, idemKey: string): Promise<BidResult>
  cancel(userId: string, auctionId: string): Promise<CancelResult>
  /** One auction, settling it first if its time is up */
  get(auctionId: string): Promise<AuctionPublic | null>
  mine(auctionId: string, userId: string): Promise<AuctionMine>
  market(sort: 'ending' | 'new' | 'price', setPrefix: string | null, page: number): Promise<{ items: MarketItem[]; more: boolean }>
  /** The user's auctions as seller or top bidder (settling any that ran out) */
  myAuctions(userId: string): Promise<{ selling: MarketItem[]; bidding: MarketItem[] }>
  /** Settle auctions whose time is up, one transaction each in id order; `userId` limits it to theirs */
  settleExpired(limit: number, userId?: string): Promise<number>
  /** Account deletion under the account lock (Security): refused while seller or top bidder of an open auction */
  leave(userId: string): Promise<LeaveResult>
  /** Preview test hook: move an own auction's end (seller only) */
  endsIn(userId: string, auctionId: string, seconds: number): Promise<boolean>
}

const SELECT_AUCTION = sql`id, seller_id, owned_card_id, card_id, start_price, min_step, status, ends_at, extensions,
  top_amount, top_bidder_id, bid_count, version, closed_at, (status = 'open' and now() >= ends_at) as expired`

/** Locks two (or one) accounts in user-id order (§4 level 2) */
async function lockAccounts(tx: Tx, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))].sort()
  const out = new Map<string, { balance: number; held: number }>()
  for (const id of unique) out.set(id, await lockAccount(tx, id))
  return out
}

const addHeld = (tx: Tx, userId: string, delta: number) =>
  tx.execute(sql`update account.point_accounts set held = held + ${delta}, version = version + 1 where user_id = ${userId}`)

/** Closes a locked, expired auction: sold (points and card move) or unsold (card freed) */
async function settleLocked(tx: Tx, a: AuctionRow) {
  const top = a.top_amount === null ? null : Number(a.top_amount)
  if (!a.top_bidder_id || top === null) {
    await tx.execute(sql`update account.auctions set status = 'unsold', closed_at = now(), version = version + 1 where id = ${a.id}`)
  } else {
    const accounts = await lockAccounts(tx, [a.seller_id, a.top_bidder_id])
    const buyer = accounts.get(a.top_bidder_id)!
    await addHeld(tx, a.top_bidder_id, -top)
    buyer.held -= top
    const paid = await credit(tx, a.top_bidder_id, buyer, -top, 'purchase', a.id, `auction:${a.id}:buy`)
    if (paid === 'insufficient') throw new Error('settlement: buyer short') // held guaranteed it: roll back
    if (a.seller_id) {
      const seller = accounts.get(a.seller_id)!
      await credit(tx, a.seller_id, seller, top, 'sale_income', a.id, `auction:${a.id}:income`)
      const cut = fee(top)
      if (cut > 0) await credit(tx, a.seller_id, seller, -cut, 'sale_fee', a.id, `auction:${a.id}:fee`)
    }
    if (a.owned_card_id) {
      await tx.execute(sql`update account.owned_cards set user_id = ${a.top_bidder_id}, auction_id = null where id = ${a.owned_card_id}`)
    }
    await tx.execute(sql`update account.auctions set status = 'sold', closed_at = now(), version = version + 1 where id = ${a.id}`)
    return
  }
  if (a.owned_card_id) await tx.execute(sql`update account.owned_cards set auction_id = null where id = ${a.owned_card_id}`)
}

const iso = (d: Date | string) => new Date(d).toISOString()

function toItem(r: { id: string; card_id: string; start_price: string; top_amount: string | null; bid_count: number; ends_at: Date; status: AuctionRow['status']; expired: boolean }): MarketItem {
  return {
    id: r.id,
    cardId: r.card_id,
    price: Number(r.top_amount ?? r.start_price),
    hasBids: r.top_amount !== null,
    bidCount: r.bid_count,
    endsAt: iso(r.ends_at),
    status: r.expired ? 'ending' : r.status,
  }
}

export class PgAuctionsStore implements AuctionsStore {
  constructor(private readonly db: NodePgDatabase) {}

  async list(userId: string, cardId: string, startPrice: number, minutes: number, idemKey: string): Promise<ListResult> {
    return this.db.transaction(async (tx) => {
      const prior = await tx.execute<{ id: string }>(sql`select id from account.auctions where seller_id = ${userId} and idem_key = ${idemKey}`)
      if (prior.rows[0]) return { kind: 'repeat', auctionId: prior.rows[0].id }
      // Level 3 only: one free copy of this card, mine, never a test copy (K-3)
      const copy = await tx.execute<{ id: string }>(sql`
        select id from account.owned_cards
        where user_id = ${userId} and card_id = ${cardId} and auction_id is null and source <> 'test'
        order by acquired_at limit 1 for update skip locked`)
      if (!copy.rows[0]) return { kind: 'no_card' }
      const open = await tx.execute<{ n: number }>(sql`select count(*)::int as n from account.auctions where seller_id = ${userId} and status = 'open'`)
      if (open.rows[0]!.n >= MAX_OPEN_PER_SELLER) return { kind: 'limit' }
      const created = await tx.execute<{ id: string }>(sql`
        insert into account.auctions (seller_id, owned_card_id, card_id, start_price, min_step, ends_at, original_ends_at, idem_key)
        values (${userId}, ${copy.rows[0].id}, ${cardId}, ${startPrice}, ${MIN_STEP},
                now() + make_interval(mins => ${minutes}), now() + make_interval(mins => ${minutes}), ${idemKey})
        returning id`)
      const id = created.rows[0]!.id
      await tx.execute(sql`update account.owned_cards set auction_id = ${id} where id = ${copy.rows[0].id}`)
      return { kind: 'listed', auctionId: id }
    })
  }

  async bid(userId: string, auctionId: string, amount: number, idemKey: string): Promise<BidResult> {
    const result = await this.db.transaction(async (tx): Promise<BidResult & { settle?: boolean }> => {
      const { rows } = await tx.execute<AuctionRow>(sql`select ${SELECT_AUCTION} from account.auctions where id = ${auctionId} for update`)
      const a = rows[0]
      if (!a) return { kind: 'not_found' }
      const prior = await tx.execute(sql`select 1 from account.bids where auction_id = ${auctionId} and bidder_id = ${userId} and idem_key = ${idemKey}`)
      if (prior.rows.length) return { kind: 'repeat', version: a.version }
      if (a.status !== 'open') return { kind: 'closed' }
      if (a.expired) {
        await settleLocked(tx, a)
        return { kind: 'ended' }
      }
      if (a.seller_id === userId) return { kind: 'own' }
      const top = a.top_amount === null ? null : Number(a.top_amount)
      const minBid = top === null ? Number(a.start_price) : top + Number(a.min_step)
      if (amount < minBid) return { kind: 'too_low', minBid }

      const accounts = await lockAccounts(tx, [userId, a.top_bidder_id])
      const me = accounts.get(userId)!
      const raising = a.top_bidder_id === userId
      const need = raising ? amount - top! : amount
      if (me.balance - me.held < need) return { kind: 'insufficient', available: me.balance - me.held, need }
      await addHeld(tx, userId, need)
      if (!raising && a.top_bidder_id && top !== null) await addHeld(tx, a.top_bidder_id, -top)

      const alias = await tx.execute<{ n: number }>(sql`
        select coalesce((select alias_no from account.bids where auction_id = ${auctionId} and bidder_id = ${userId} limit 1),
                        (select coalesce(max(alias_no), 0) + 1 from account.bids where auction_id = ${auctionId})) as n`)
      await tx.execute(sql`
        insert into account.bids (auction_id, bidder_id, amount, alias_no, idem_key)
        values (${auctionId}, ${userId}, ${amount}, ${alias.rows[0]!.n}, ${idemKey})`)
      const updated = await tx.execute<{ version: number }>(sql`
        update account.auctions set
          top_amount = ${amount}, top_bidder_id = ${userId}, bid_count = bid_count + 1, version = version + 1,
          ends_at = case when ends_at - now() < make_interval(secs => ${EXTEND_SECONDS}) and extensions < ${MAX_EXTENSIONS}
                         then now() + make_interval(secs => ${EXTEND_SECONDS}) else ends_at end,
          extensions = case when ends_at - now() < make_interval(secs => ${EXTEND_SECONDS}) and extensions < ${MAX_EXTENSIONS}
                            then extensions + 1 else extensions end
        where id = ${auctionId} returning version`)
      return { kind: 'ok', version: updated.rows[0]!.version }
    })
    return result
  }

  async cancel(userId: string, auctionId: string): Promise<CancelResult> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<AuctionRow>(sql`select ${SELECT_AUCTION} from account.auctions where id = ${auctionId} for update`)
      const a = rows[0]
      if (!a || a.seller_id !== userId) return 'not_found'
      if (a.status !== 'open' || a.expired) return 'closed'
      if (a.bid_count > 0) return 'has_bids'
      await tx.execute(sql`update account.auctions set status = 'cancelled', closed_at = now(), version = version + 1 where id = ${auctionId}`)
      if (a.owned_card_id) await tx.execute(sql`update account.owned_cards set auction_id = null where id = ${a.owned_card_id}`)
      return 'ok'
    })
  }

  /** One auction's settlement in its own transaction (level 1 first); false if nothing to do */
  /** : the sweep never waits behind a live bid (that bid settles it itself: Security) */
  private async settleOne(auctionId: string, skipLocked = false) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<AuctionRow>(
        sql`select ${SELECT_AUCTION} from account.auctions where id = ${auctionId} for update ${skipLocked ? sql`skip locked` : sql``}`,
      )
      const a = rows[0]
      if (!a || !a.expired) return false
      await settleLocked(tx, a)
      return true
    })
  }

  async settleExpired(limit: number, userId?: string) {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select id from account.auctions
      where status = 'open' and ends_at <= now() ${userId ? sql`and (seller_id = ${userId} or top_bidder_id = ${userId})` : sql``}
      order by id limit ${limit}`)
    let n = 0
    for (const { id } of rows) if (await this.settleOne(id, !userId)) n++
    return n
  }

  private async settleIfExpired(auctionId: string) {
    const { rows } = await this.db.execute<{ expired: boolean }>(sql`select (status = 'open' and now() >= ends_at) as expired from account.auctions where id = ${auctionId}`)
    if (!rows[0]) return false
    if (rows[0].expired) await this.settleOne(auctionId)
    return true
  }

  async get(auctionId: string): Promise<AuctionPublic | null> {
    if (!(await this.settleIfExpired(auctionId))) return null
    const { rows } = await this.db.execute<AuctionRow>(sql`select ${SELECT_AUCTION} from account.auctions where id = ${auctionId}`)
    const a = rows[0]!
    const bidRows = await this.db.execute<{ alias_no: number; amount: string; created_at: Date }>(sql`
      select alias_no, amount, created_at from account.bids where auction_id = ${auctionId} order by created_at desc limit 20`)
    const topAlias = a.top_bidder_id
      ? (await this.db.execute<{ alias_no: number }>(sql`select alias_no from account.bids where auction_id = ${auctionId} and bidder_id = ${a.top_bidder_id} limit 1`)).rows[0]?.alias_no
      : undefined
    const top = a.top_amount === null ? null : Number(a.top_amount)
    return {
      id: a.id,
      cardId: a.card_id,
      status: a.expired ? 'ending' : a.status,
      startPrice: Number(a.start_price),
      minStep: Number(a.min_step),
      minBid: top === null ? Number(a.start_price) : top + Number(a.min_step),
      topAmount: top,
      topAlias: topAlias ? aliasOf(topAlias) : top !== null ? '탈퇴한 사용자' : null,
      bidCount: a.bid_count,
      endsAt: iso(a.ends_at),
      extensions: a.extensions,
      maxExtensions: MAX_EXTENSIONS,
      version: a.version,
      closedAt: a.closed_at ? iso(a.closed_at) : null,
      bids: bidRows.rows.map((b) => ({ alias: aliasOf(b.alias_no), amount: Number(b.amount), at: iso(b.created_at) })),
    }
  }

  async mine(auctionId: string, userId: string): Promise<AuctionMine> {
    // Like every read that can show a result: an auction whose time is up is settled first
    await this.settleIfExpired(auctionId)
    const { rows } = await this.db.execute<{ seller_id: string | null; top_bidder_id: string | null; top_amount: string | null; status: string; alias_no: number | null }>(sql`
      select a.seller_id, a.top_bidder_id, a.top_amount, a.status,
             (select alias_no from account.bids b where b.auction_id = a.id and b.bidder_id = ${userId} limit 1) as alias_no
      from account.auctions a where a.id = ${auctionId}`)
    const r = rows[0]
    if (!r) return { isSeller: false, isTop: false, myAlias: null, held: 0 }
    const isTop = r.top_bidder_id === userId
    return {
      isSeller: r.seller_id === userId,
      isTop,
      myAlias: r.alias_no ? aliasOf(r.alias_no) : null,
      held: isTop && r.status === 'open' && r.top_amount !== null ? Number(r.top_amount) : 0,
    }
  }

  async market(sort: 'ending' | 'new' | 'price', setPrefix: string | null, page: number) {
    // Settle what ran out on this page first (one transaction each)
    await this.settleExpired(20)
    const order =
      sort === 'new' ? sql`starts_at desc, id` : sort === 'price' ? sql`coalesce(top_amount, start_price) desc, id` : sql`ends_at asc, id`
    const { rows } = await this.db.execute<{ id: string; card_id: string; start_price: string; top_amount: string | null; bid_count: number; ends_at: Date; status: AuctionRow['status']; expired: boolean }>(sql`
      select id, card_id, start_price, top_amount, bid_count, ends_at, status, (now() >= ends_at) as expired
      from account.auctions
      where status = 'open' ${setPrefix ? sql`and starts_with(card_id, ${setPrefix})` : sql``}
      order by ${order}
      limit 25 offset ${page * 24}`)
    return { items: rows.slice(0, 24).map(toItem), more: rows.length > 24 }
  }

  async myAuctions(userId: string) {
    await this.settleExpired(20, userId)
    const { rows } = await this.db.execute<{ id: string; card_id: string; start_price: string; top_amount: string | null; bid_count: number; ends_at: Date; status: AuctionRow['status']; expired: boolean; selling: boolean }>(sql`
      select id, card_id, start_price, top_amount, bid_count, ends_at, status, (status = 'open' and now() >= ends_at) as expired,
             (seller_id = ${userId}) as selling
      from account.auctions
      where seller_id = ${userId}
         or id in (select auction_id from account.bids where bidder_id = ${userId})
      order by (status = 'open') desc, ends_at desc
      limit 100`)
    return { selling: rows.filter((r) => r.selling).map(toItem), bidding: rows.filter((r) => !r.selling).map(toItem) }
  }

  async leave(userId: string): Promise<LeaveResult> {
    return this.db.transaction(async (tx) => {
      // Level 2 first: a bid by this user (level 1 then 2) waits for us, so the check below holds
      await lockAccount(tx, userId)
      const { rows } = await tx.execute<{ id: string }>(sql`
        select id from account.auctions where status = 'open' and (seller_id = ${userId} or top_bidder_id = ${userId}) order by id`)
      if (rows.length) return { kind: 'blocked', auctions: rows.map((r) => r.id) }
      await tx.execute(sql`delete from account.users where id = ${userId}`)
      return { kind: 'deleted' }
    })
  }

  async endsIn(userId: string, auctionId: string, seconds: number) {
    const { rows } = await this.db.execute(sql`
      update account.auctions set ends_at = least(greatest(now() + make_interval(secs => ${seconds}), starts_at + interval '1 second'), original_ends_at + interval '20 minutes'), version = version + 1
      where id = ${auctionId} and seller_id = ${userId} and status = 'open' returning id`)
    return rows.length > 0
  }
}
