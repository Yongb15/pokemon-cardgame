// Points (docs/auction/design.md §2, ADR 0005): an append-only ledger and a balance row kept in the
// same transaction. Every change locks the user's balance row first (FOR UPDATE), writes one ledger
// row whose (user, idem_key) is unique — a retried request finds its first row and changes nothing —
// then moves the balance. The database refuses a negative or over-held balance (CHECK).

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { PointKind } from '../db/schema.js'

/** The one-time first bonus (new and existing accounts alike) and the daily check-in */
export const FIRST_BONUS = 10_000
export const DAILY_BONUS = 500
/** Ledger page size */
export const ENTRIES_PAGE = 20

/** Grants the points code needs (checked at start-up with the others) */
export const POINTS_PRIVILEGES: [string, string | null, string][] = [
  ['point_entries', null, 'SELECT'],
  ['point_entries', 'user_id', 'INSERT'],
  ['point_entries', 'amount', 'INSERT'],
  ['point_entries', 'kind', 'INSERT'],
  ['point_entries', 'ref', 'INSERT'],
  ['point_entries', 'idem_key', 'INSERT'],
  ['point_accounts', null, 'SELECT'],
  ['point_accounts', 'user_id', 'INSERT'],
  ['point_accounts', 'balance', 'UPDATE'],
  ['point_accounts', 'held', 'UPDATE'],
  ['point_accounts', 'version', 'UPDATE'],
  ['daily_claims', null, 'SELECT'],
  ['daily_claims', 'user_id', 'INSERT'],
  ['daily_claims', 'day', 'INSERT'],
]

/** Grants api_rw must NOT have on them (Security A-1): the ledger is never edited or deleted */
export const POINTS_EXCESS: [string, string | null, string][] = [
  ['point_entries', null, 'UPDATE'],
  ['point_entries', null, 'DELETE'],
  ['point_entries', null, 'TRUNCATE'],
  ['point_accounts', null, 'DELETE'],
  ['point_accounts', 'user_id', 'UPDATE'],
  ['daily_claims', null, 'DELETE'],
  ['daily_claims', null, 'UPDATE'],
]

export interface PointsSummary {
  balance: number
  held: number
  available: number
  /** Today in Korea (YYYY-MM-DD) and whether today's check-in is taken */
  today: string
  claimedToday: boolean
  /** The first bonus was granted by this very request (for a one-time "+10,000P" note) */
  bonusGranted: boolean
}

export interface PointEntry {
  id: string
  amount: number
  kind: PointKind
  ref: string | null
  createdAt: Date
}

export type CreditResult = 'ok' | 'duplicate' | 'insufficient'

export interface LedgerCheck {
  mine: { balance: number; held: number; ledgerSum: number; ok: boolean }
  /** Whole database, counts only (Security T-4) */
  all: { accounts: number; mismatched: number; overHeld: number }
}

export interface PointsStore {
  summary(userId: string): Promise<PointsSummary>
  /** Today's check-in: false when it was already taken (today, Korea time) */
  claimDaily(userId: string): Promise<{ claimed: boolean; summary: PointsSummary }>
  entries(userId: string, before: { createdAt: Date; id: string } | null): Promise<PointEntry[]>
  /** A preview top-up for a test account (admin_adjust, ref 'test') */
  adjust(userId: string, amount: number, idemKey: string): Promise<CreditResult>
  ledgerCheck(userId: string): Promise<LedgerCheck>
}

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]
const KST_TODAY = sql`(now() at time zone 'Asia/Seoul')::date`

/**
 * Locks the user's balance row, creating it with the first bonus if the user has none yet (so
 * every account, new or existing, gets the bonus exactly once). Returns whether it granted it.
 */
async function lockAccount(tx: Tx, userId: string): Promise<{ balance: number; held: number; granted: boolean }> {
  const created = await tx.execute<{ user_id: string }>(
    sql`insert into account.point_accounts (user_id) values (${userId}) on conflict (user_id) do nothing returning user_id`,
  )
  const { rows } = await tx.execute<{ balance: string; held: string }>(
    sql`select balance, held from account.point_accounts where user_id = ${userId} for update`,
  )
  let balance = Number(rows[0]!.balance)
  const held = Number(rows[0]!.held)
  let granted = false
  if (created.rows.length) {
    const inserted = await tx.execute(
      sql`insert into account.point_entries (user_id, amount, kind, ref, idem_key)
          values (${userId}, ${FIRST_BONUS}, 'signup_bonus', null, 'signup') on conflict (user_id, idem_key) do nothing returning id`,
    )
    if (inserted.rows.length) {
      await tx.execute(sql`update account.point_accounts set balance = balance + ${FIRST_BONUS}, version = version + 1 where user_id = ${userId}`)
      balance += FIRST_BONUS
      granted = true
    }
  }
  return { balance, held, granted }
}

/** One ledger row and the balance move, inside the caller's transaction (the row already locked) */
async function credit(tx: Tx, userId: string, current: { balance: number; held: number }, amount: number, kind: PointKind, ref: string | null, idemKey: string): Promise<CreditResult> {
  if (current.balance + amount < current.held) return 'insufficient'
  const inserted = await tx.execute(
    sql`insert into account.point_entries (user_id, amount, kind, ref, idem_key)
        values (${userId}, ${amount}, ${kind}, ${ref}, ${idemKey}) on conflict (user_id, idem_key) do nothing returning id`,
  )
  if (!inserted.rows.length) return 'duplicate'
  await tx.execute(sql`update account.point_accounts set balance = balance + ${amount}, version = version + 1 where user_id = ${userId}`)
  current.balance += amount
  return 'ok'
}

export class PgPointsStore implements PointsStore {
  constructor(private readonly db: NodePgDatabase) {}

  private async read(tx: Tx, userId: string, granted: boolean): Promise<PointsSummary> {
    const { rows } = await tx.execute<{ balance: string; held: string; today: string; claimed: boolean }>(sql`
      select a.balance, a.held, ${KST_TODAY}::text as today,
             exists (select 1 from account.daily_claims d where d.user_id = a.user_id and d.day = ${KST_TODAY}) as claimed
      from account.point_accounts a where a.user_id = ${userId}`)
    const r = rows[0]!
    const balance = Number(r.balance)
    const held = Number(r.held)
    return { balance, held, available: balance - held, today: r.today, claimedToday: r.claimed, bonusGranted: granted }
  }

  async summary(userId: string) {
    // Read without locking when the account exists; otherwise create it with the first bonus
    const existing = await this.db.execute(sql`select 1 from account.point_accounts where user_id = ${userId}`)
    return this.db.transaction(async (tx) => {
      const granted = existing.rows.length ? false : (await lockAccount(tx, userId)).granted
      return this.read(tx, userId, granted)
    })
  }

  async claimDaily(userId: string) {
    return this.db.transaction(async (tx) => {
      const account = await lockAccount(tx, userId)
      const claim = await tx.execute<{ day: string }>(
        sql`insert into account.daily_claims (user_id, day) values (${userId}, ${KST_TODAY}) on conflict do nothing returning day::text`,
      )
      const day = claim.rows[0]?.day
      if (day) await credit(tx, userId, account, DAILY_BONUS, 'daily_bonus', null, `daily:${day}`)
      return { claimed: !!day, summary: await this.read(tx, userId, account.granted) }
    })
  }

  async entries(userId: string, before: { createdAt: Date; id: string } | null) {
    const { rows } = await this.db.execute<{ id: string; amount: string; kind: PointKind; ref: string | null; created_at: Date }>(sql`
      select id, amount, kind, ref, created_at from account.point_entries
      where user_id = ${userId}
        ${before ? sql`and (created_at, id) < (${before.createdAt.toISOString()}::timestamptz, ${before.id}::uuid)` : sql``}
      order by created_at desc, id desc
      limit ${ENTRIES_PAGE}`)
    return rows.map((r) => ({ id: r.id, amount: Number(r.amount), kind: r.kind, ref: r.ref, createdAt: new Date(r.created_at) }))
  }

  async adjust(userId: string, amount: number, idemKey: string) {
    return this.db.transaction(async (tx) => {
      const account = await lockAccount(tx, userId)
      return credit(tx, userId, account, amount, 'admin_adjust', 'test', idemKey)
    })
  }

  async ledgerCheck(userId: string): Promise<LedgerCheck> {
    const { rows } = await this.db.execute<{ balance: string | null; held: string | null; sum: string }>(sql`
      select a.balance, a.held, coalesce((select sum(amount) from account.point_entries e where e.user_id = ${userId}), 0) as sum
      from (select ${userId}::uuid as user_id) u left join account.point_accounts a on a.user_id = u.user_id`)
    const mine = rows[0]!
    const all = await this.db.execute<{ accounts: string; mismatched: string; over_held: string }>(sql`
      select count(*) as accounts,
             count(*) filter (where a.balance <> coalesce(s.sum, 0)) as mismatched,
             count(*) filter (where a.held > a.balance) as over_held
      from account.point_accounts a
      left join (select user_id, sum(amount) as sum from account.point_entries group by user_id) s on s.user_id = a.user_id`)
    const a = all.rows[0]!
    const balance = Number(mine.balance ?? 0)
    const ledgerSum = Number(mine.sum)
    return {
      mine: { balance, held: Number(mine.held ?? 0), ledgerSum, ok: balance === ledgerSum },
      all: { accounts: Number(a.accounts), mismatched: Number(a.mismatched), overHeld: Number(a.over_held) },
    }
  }
}
