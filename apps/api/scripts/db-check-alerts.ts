// Price alert checks against a real Postgres (the dev branch, as the owner): the 50 limit under
// parallel saves, the once-an-hour claim, firing into one notification row, and the cascade on
// account deletion. Throwaway users, removed at the end. Prints counts only.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-alerts.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { MAX_ALERTS, PgAlertsStore } from '../src/alerts/store.js'
import { PgNotificationsStore } from '../src/notifications/store.js'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER (the dev branch) is not set')
const pool = new pg.Pool({ connectionString: url, max: 20 })
const db = drizzle(pool)
const isDev = await db.execute(sql`select 1 from public.dev_marker limit 1`).then(
  () => true,
  () => false,
)
if (!isDev) throw new Error('refusing: not the dev branch (no dev_marker)')

const alerts = new PgAlertsStore(db)
const notes = new PgNotificationsStore(db)
const users: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function user(name: string) {
  const { rows } = await db.execute<{ id: string }>(sql`insert into account.users (nickname) values (${name}) returning id`)
  users.push(rows[0]!.id)
  return rows[0]!.id
}

try {
  // 1. The limit holds under 60 parallel saves of different cards
  {
    const u = await user('점검-알림1')
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => alerts.save(u, `me5-${i + 1}`, 1000)))
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from account.price_alerts where user_id = ${u}`)
    check(`at most ${MAX_ALERTS} alerts under parallel saves`, rows[0]!.n === MAX_ALERTS, `${rows[0]!.n} rows, ${results.filter((r) => r === 'limit').length} × limit`)
    check('re-saving an existing card at the limit still works', (await alerts.save(u, 'me5-1', 2000)) === 'saved')
  }

  // 2. Claim once an hour, fire once, notification is a snapshot, re-arm resurfaces the same row
  {
    const u = await user('점검-알림2')
    await alerts.save(u, 'me5-1', 45_000)
    await alerts.save(u, 'me5-2', 1_000)
    const first = await alerts.claimCheck(u)
    const parallel = await Promise.all([alerts.claimCheck(u), alerts.claimCheck(u)])
    check('first claim gets the armed alerts', first.length === 2)
    check('claims within the hour get nothing', parallel.every((p) => p.length === 0))
    const fired = await alerts.fire(u, [{ cardId: 'me5-1', targetKrw: 45_000, krw: 44_800 }])
    check('fires once', fired === 1 && (await alerts.fire(u, [{ cardId: 'me5-1', targetKrw: 45_000, krw: 44_000 }])) === 0)
    const n1 = await notes.list(u)
    const item = n1.items.find((i) => i.kind === 'price')
    check('notification has card, price, target and no auction', item?.cardId === 'me5-1' && item.amount === 44_800 && item.target === 45_000 && item.auctionId === null)
    const list = await alerts.list(u)
    check('fired alert is off with a time', list.find((a) => a.cardId === 'me5-1')?.active === false && !!list.find((a) => a.cardId === 'me5-1')?.triggeredAt)
    await notes.markRead(u)
    await alerts.save(u, 'me5-1', 40_000)
    check('fire after a target change at the old target does nothing', (await alerts.fire(u, [{ cardId: 'me5-1', targetKrw: 45_000, krw: 39_000 }])) === 0)
    await alerts.fire(u, [{ cardId: 'me5-1', targetKrw: 40_000, krw: 39_000 }])
    const n2 = (await notes.list(u)).items.filter((i) => i.kind === 'price')
    check('re-armed alert fires into the same row, unread, new values', n2.length === 1 && !n2[0]!.read && n2[0]!.amount === 39_000 && n2[0]!.target === 40_000)
    check('remove deletes the alert', (await alerts.remove(u, 'me5-2')) && (await alerts.list(u)).length === 1)
    // Backstops: a price notification must have a target and no auction
    const bad = await db.execute(sql`insert into account.notifications (user_id, kind, card_id, amount) values (${u}, 'price', 'me5-9', 100)`).then(
      () => false,
      () => true,
    )
    check('price notification without a target is refused (CHECK)', bad)
    // Deleting the account takes alerts, the check log and notifications with it
    await db.execute(sql`delete from account.users where id = ${u}`)
    const left = await db.execute<{ a: number; c: number; n: number }>(sql`
      select (select count(*) from account.price_alerts where user_id = ${u})::int as a,
             (select count(*) from account.alert_checks where user_id = ${u})::int as c,
             (select count(*) from account.notifications where user_id = ${u})::int as n`)
    check('account deletion cascades', left.rows[0]!.a === 0 && left.rows[0]!.c === 0 && left.rows[0]!.n === 0)
  }
} finally {
  if (users.length) await db.execute(sql`delete from account.users where id = any(${`{${users.join(',')}}`}::uuid[])`)
  await pool.end()
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  if (failures) process.exitCode = 1
}
