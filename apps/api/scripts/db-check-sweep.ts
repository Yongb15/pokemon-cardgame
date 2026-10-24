// The E2E sweeper against a real Postgres (the dev branch, as the owner), Security E-3: only test-only accounts
// named e2e-… and over two hours old go, an open auction doesn't block them, and nobody else is touched.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-sweep.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { PgAuctionsStore } from '../src/auctions/store.js'
import { PgPointsStore } from '../src/points/store.js'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER (the dev branch) is not set')
const pool = new pg.Pool({ connectionString: url, max: 5 })
const db = drizzle(pool)
const isDev = await db.execute(sql`select 1 from public.dev_marker limit 1`).then(
  () => true,
  () => false,
)
if (!isDev) throw new Error('refusing: not the dev branch (no dev_marker)')

const auctions = new PgAuctionsStore(db)
const points = new PgPointsStore(db)
const users: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const tag = Math.random().toString(36).slice(2, 8)
async function account(provider: string, subject: string, hoursOld: number) {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into account.users (nickname, created_at) values (${`점검-${subject}`}, now() - make_interval(hours => ${hoursOld})) returning id`)
  const id = rows[0]!.id
  users.push(id)
  await db.execute(sql`insert into account.oauth_accounts (provider, subject, user_id) values (${provider}, ${subject}, ${id})`)
  await points.summary(id)
  return id
}
const exists = async (id: string) => (await db.execute(sql`select 1 from account.users where id = ${id}`)).rows.length === 1

try {
  const caller = await account('test', `e2e-${tag}-caller`, 5)
  const old = await account('test', `e2e-${tag}-old`, 3)
  const seller = await account('test', `e2e-${tag}-seller`, 3)
  const recent = await account('test', `e2e-${tag}-recent`, 0)
  const qa = await account('test', `qa-${tag}-old`, 5)
  const mixed = await account('test', `e2e-${tag}-mixed`, 5)
  await db.execute(sql`insert into account.oauth_accounts (provider, subject, user_id) values ('google', ${`g-${tag}`}, ${mixed})`)
  // The seller has an open auction (one owned card)
  await db.execute(sql`insert into account.owned_cards (user_id, card_id, source) values (${seller}, 'me5-1', 'pack')`)
  const listed = await auctions.list(seller, 'me5-1', 100, 60, `k${tag}listing0`)
  check('the seller has an open auction (leaving would be blocked)', listed.kind === 'listed' && (await auctions.leave(seller)).kind === 'blocked')

  const n = await auctions.sweepE2E(caller)
  check('old e2e account → deleted', !(await exists(old)))
  check('old e2e seller with an open auction → settled, then deleted', !(await exists(seller)))
  check('a recent e2e account (under 2 h) stays', await exists(recent))
  check('the caller stays', await exists(caller))
  check('a qa test account stays', await exists(qa))
  check('an e2e account that also signs in with Google stays', await exists(mixed))
  check('the count includes the two (older e2e leftovers on dev count too)', n >= 2, String(n))
  const left = await db.execute<{ n: number }>(sql`select count(*)::int as n from account.auctions where id = ${listed.kind === 'listed' ? listed.auctionId : null} and status = 'open'`)
  check('the swept auction is no longer open', left.rows[0]!.n === 0)
} finally {
  const list = `{${users.join(',')}}`
  await db.execute(sql`delete from account.auctions where seller_id = any(${list}::uuid[])`)
  await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  await pool.end()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
