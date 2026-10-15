// Admin point grants (docs/auction/admin-points.md, Security G-1..G-4, R-1..R-6). An admin finds a user
// by the member code shown on that user's /me and grants points; grants only, never deductions.
// Lock order for a grant: the admin's advisory lock, then the target's point account (credit()).
// The grant record and the user's notification are written in the same transaction (§7).

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { credit, lockAccount } from '../points/store.js'

export const GRANT_MAX = 100_000
/** Per admin, per Korea-time day (database clock: A-1) */
export const GRANT_DAILY_MAX = 500_000
/** The reason is cleared this long after the grant; amount and time stay (R-3) */
export const GRANT_REASON_KEEP_DAYS = 365
export const RECENT_GRANT_DAYS = 30
export const MEMBER_CODE = /^[0-9A-F]{8}$/
export const GRANT_IDEM = /^[A-Za-z0-9_-]{8,64}$/

export const GRANTS_PRIVILEGES: [string, string | null, string][] = [
  ['users', 'member_code', 'SELECT'],
  ['admin_point_grants', null, 'SELECT'],
  ...['admin_id', 'user_id', 'amount', 'reason', 'entry_id', 'idem_key'].map((c): [string, string, string] => ['admin_point_grants', c, 'INSERT']),
  ['admin_point_grants', 'reason', 'UPDATE'],
]

/** The record is append-only apart from clearing old reasons; nobody's code can be changed */
export const GRANTS_EXCESS: [string, string | null, string][] = [
  ['users', 'member_code', 'UPDATE'],
  ['admin_point_grants', null, 'DELETE'],
  ...['admin_id', 'user_id', 'amount', 'entry_id', 'idem_key', 'created_at'].map((c): [string, string, string] => ['admin_point_grants', c, 'UPDATE']),
]

export interface Member {
  userId: string
  nickname: string
  joinedAt: string
}

export type GrantResult =
  | { kind: 'ok'; grantId: string; replay: boolean }
  | { kind: 'not_found' }
  /** The target is an admin, the granting admin included (R-1) */
  | { kind: 'admin_target' }
  | { kind: 'limit'; usedToday: number }
  /** The same idempotency key with a different member or amount (G-2) */
  | { kind: 'idem_conflict' }

export interface GrantRecord {
  id: string
  at: string
  /** null once the user has left */
  memberCode: string | null
  userId: string | null
  amount: number
  reason: string | null
}

export interface GrantsStore {
  member(code: string): Promise<Member | null>
  grant(adminId: string, code: string, amount: number, reason: string, idemKey: string): Promise<GrantResult>
  /** Every admin's grants of the last 30 days, newest first (R-2) */
  recent(): Promise<GrantRecord[]>
  /** Clears reasons older than a year; returns how many */
  clearOldReasons(): Promise<number>
}

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]
const iso = (d: Date | string) => new Date(d).toISOString()
const KST_DAY_START = sql`(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`

export class PgGrantsStore implements GrantsStore {
  constructor(private readonly db: NodePgDatabase) {}

  async member(code: string) {
    const { rows } = await this.db.execute<{ id: string; nickname: string; created_at: Date }>(
      sql`select id, nickname, created_at from account.users where member_code = ${code}`,
    )
    const u = rows[0]
    return u ? { userId: u.id, nickname: u.nickname, joinedAt: iso(u.created_at) } : null
  }

  async grant(adminId: string, code: string, amount: number, reason: string, idemKey: string): Promise<GrantResult> {
    try {
      return await this.db.transaction(async (tx: Tx) => {
        // One grant at a time per admin: the daily sum below can't be raced (G-3)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`admin-grant:${adminId}`}, 0))`)

        const prior = await tx.execute<{ id: string; amount: number; code: string | null }>(sql`
          select g.id, g.amount, u.member_code as code
          from account.admin_point_grants g left join account.users u on u.id = g.user_id
          where g.admin_id = ${adminId} and g.idem_key = ${idemKey}`)
        if (prior.rows[0]) {
          const p = prior.rows[0]
          return p.code === code && p.amount === amount ? { kind: 'ok', grantId: p.id, replay: true } : { kind: 'idem_conflict' }
        }

        const target = await tx.execute<{ id: string; admin: boolean }>(sql`
          select u.id, exists (select 1 from account.admins a where a.user_id = u.id) as admin
          from account.users u where u.member_code = ${code}`)
        const t = target.rows[0]
        if (!t) return { kind: 'not_found' }
        if (t.admin || t.id === adminId) return { kind: 'admin_target' }

        const used = await tx.execute<{ n: string }>(sql`
          select coalesce(sum(amount), 0) as n from account.admin_point_grants
          where admin_id = ${adminId} and created_at >= ${KST_DAY_START}`)
        const usedToday = Number(used.rows[0]!.n)
        if (usedToday + amount > GRANT_DAILY_MAX) return { kind: 'limit', usedToday }

        // The ledger's own idempotency is per target user; two admins may use the same key, so it is
        // tied to the admin too (and stays within the ledger's 80-character key)
        const ledgerKey = `admin-grant:${createHash('sha256').update(`${adminId}:${idemKey}`).digest('hex').slice(0, 40)}`
        const account = await lockAccount(tx, t.id)
        const credited = await credit(tx, t.id, account, amount, 'admin_adjust', 'grant', ledgerKey)
        if (credited !== 'ok') return { kind: 'idem_conflict' }
        const entry = await tx.execute<{ id: string }>(
          sql`select id from account.point_entries where user_id = ${t.id} and idem_key = ${ledgerKey}`,
        )
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into account.admin_point_grants (admin_id, user_id, amount, reason, entry_id, idem_key)
          values (${adminId}, ${t.id}, ${amount}, ${reason}, ${entry.rows[0]!.id}, ${idemKey}) returning id`)
        // The user's notification: the amount only, never the reason or who granted it (§7, A-3)
        await tx.execute(sql`insert into account.notifications (user_id, kind, amount) values (${t.id}, 'grant', ${amount})`)
        return { kind: 'ok', grantId: inserted.rows[0]!.id, replay: false }
      })
    } catch (error) {
      // The target left while this ran: the point account's foreign key fails (R-6)
      const pgCode = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
      if (pgCode === '23503') return { kind: 'not_found' }
      throw error
    }
  }

  async recent() {
    const { rows } = await this.db.execute<{ id: string; created_at: Date; code: string | null; user_id: string | null; amount: number; reason: string | null }>(sql`
      select g.id, g.created_at, u.member_code as code, g.user_id, g.amount, g.reason
      from account.admin_point_grants g left join account.users u on u.id = g.user_id
      where g.created_at > now() - make_interval(days => ${RECENT_GRANT_DAYS})
      order by g.created_at desc
      limit 200`)
    return rows.map((r) => ({ id: r.id, at: iso(r.created_at), memberCode: r.code, userId: r.user_id, amount: r.amount, reason: r.reason }))
  }

  async clearOldReasons() {
    const { rows } = await this.db.execute(sql`
      update account.admin_point_grants set reason = null
      where reason is not null and created_at < now() - make_interval(days => ${GRANT_REASON_KEEP_DAYS})
      returning id`)
    return rows.length
  }
}
