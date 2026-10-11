// Price alerts (docs/price/alerts.md, Security PA-1..PA-3). The user's own settings: hard-deleted on
// removal (Security Q2). Checked lazily, at most once an hour per user, when they read their
// notifications; prices come from our public batch endpoint, never from price tables (api_rw has none).

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

export const MAX_ALERTS = 50
export const MIN_TARGET = 100
export const MAX_TARGET = 100_000_000

export const ALERTS_PRIVILEGES: [string, string | null, string][] = [
  ['price_alerts', null, 'SELECT'],
  ['price_alerts', null, 'DELETE'],
  ...['user_id', 'card_id', 'target_krw', 'active', 'triggered_at'].map((c): [string, string, string] => ['price_alerts', c, 'INSERT']),
  ...['target_krw', 'active', 'triggered_at'].map((c): [string, string, string] => ['price_alerts', c, 'UPDATE']),
  ['alert_checks', null, 'SELECT'],
  ...['user_id', 'checked_at'].map((c): [string, string, string] => ['alert_checks', c, 'INSERT']),
  ['alert_checks', 'checked_at', 'UPDATE'],
  ['notifications', 'target', 'INSERT'],
  ['notifications', 'target', 'UPDATE'],
]

/** DELETE is allowed on price_alerts only; never on the check log (or the ledgers: their own lists) */
export const ALERTS_EXCESS: [string, string | null, string][] = [
  ['price_alerts', 'user_id', 'UPDATE'],
  ['price_alerts', 'card_id', 'UPDATE'],
  ['alert_checks', null, 'DELETE'],
  ['alert_checks', 'user_id', 'UPDATE'],
]

export interface PriceAlert {
  cardId: string
  targetKrw: number
  active: boolean
  triggeredAt: string | null
}

export interface AlertsStore {
  list(userId: string): Promise<PriceAlert[]>
  /** Creates or replaces (and re-arms) one alert; 'limit' at 50 other cards */
  save(userId: string, cardId: string, targetKrw: number): Promise<'saved' | 'limit'>
  remove(userId: string, cardId: string): Promise<boolean>
  /** The user's armed alerts, if an hour has passed since the last check (and claims this check) */
  claimCheck(userId: string): Promise<{ cardId: string; targetKrw: number }[]>
  /** Fires the ones whose price is at or under the target: alert off + one notification each */
  fire(userId: string, hits: { cardId: string; targetKrw: number; krw: number }[]): Promise<number>
}

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]

export class PgAlertsStore implements AlertsStore {
  constructor(private readonly db: NodePgDatabase) {}

  async list(userId: string) {
    const { rows } = await this.db.execute<{ card_id: string; target_krw: number; active: boolean; triggered_at: Date | null }>(sql`
      select card_id, target_krw, active, triggered_at from account.price_alerts
      where user_id = ${userId} order by created_at desc, card_id`)
    return rows.map((r) => ({ cardId: r.card_id, targetKrw: r.target_krw, active: r.active, triggeredAt: r.triggered_at ? new Date(r.triggered_at).toISOString() : null }))
  }

  async save(userId: string, cardId: string, targetKrw: number) {
    return this.db.transaction(async (tx: Tx) => {
      // One writer per user, so two saves can't both see 49 and make 51 (like the deck limit)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`alerts:${userId}`}, 0))`)
      const { rows } = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from account.price_alerts where user_id = ${userId} and card_id <> ${cardId}`)
      if (rows[0]!.n >= MAX_ALERTS) return 'limit' as const
      await tx.execute(sql`
        insert into account.price_alerts (user_id, card_id, target_krw, active, triggered_at)
        values (${userId}, ${cardId}, ${targetKrw}, true, null)
        on conflict (user_id, card_id) do update set target_krw = excluded.target_krw, active = true, triggered_at = null`)
      return 'saved' as const
    })
  }

  async remove(userId: string, cardId: string) {
    const { rows } = await this.db.execute(sql`delete from account.price_alerts where user_id = ${userId} and card_id = ${cardId} returning card_id`)
    return rows.length > 0
  }

  async claimCheck(userId: string) {
    const armed = await this.db.execute<{ card_id: string; target_krw: number }>(sql`
      select card_id, target_krw from account.price_alerts where user_id = ${userId} and active order by card_id`)
    if (!armed.rows.length) return []
    // Atomic: of several tabs or presses in the same hour, exactly one gets to check (Security PA-2)
    const claimed = await this.db.execute(sql`
      insert into account.alert_checks (user_id, checked_at) values (${userId}, now())
      on conflict (user_id) do update set checked_at = now() where account.alert_checks.checked_at < now() - interval '1 hour'
      returning user_id`)
    if (!claimed.rows.length) return []
    return armed.rows.map((r) => ({ cardId: r.card_id, targetKrw: r.target_krw }))
  }

  async fire(userId: string, hits: { cardId: string; targetKrw: number; krw: number }[]) {
    if (!hits.length) return 0
    // Its own transaction, never inside a settlement: only this user's alerts and notifications (PA-2)
    return this.db.transaction(async (tx: Tx) => {
      let n = 0
      for (const hit of hits) {
        // Still armed at the same target: an edit in between wins
        const off = await tx.execute(sql`
          update account.price_alerts set active = false, triggered_at = now()
          where user_id = ${userId} and card_id = ${hit.cardId} and active and target_krw = ${hit.targetKrw}
          returning card_id`)
        if (!off.rows.length) continue
        await tx.execute(sql`
          insert into account.notifications (user_id, kind, card_id, amount, target)
          values (${userId}, 'price', ${hit.cardId}, ${hit.krw}, ${hit.targetKrw})
          on conflict (user_id, card_id) where kind = 'price'
          do update set amount = excluded.amount, target = excluded.target, created_at = clock_timestamp(), read_at = null`)
        n++
      }
      return n
    })
  }
}
