// Seller badge checks against a real Postgres (the dev branch, as the owner), docs/auction/seller-badge.md and
// Security B-1..B-5: distinct buyers of sold auctions only, the 20 cap, a seller who left, the new-member flag by
// database time, and the same 200/404 as GET /auctions/:id for every status. Throwaway users and auctions.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-badge.ts

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { AUCTION_STATUSES } from '../src/db/schema.js'
import { PgAuctionsStore } from '../src/auctions/store.js'

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
const users: string[] = []
const made: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function user(name: string, ageDays = 30) {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into account.users (nickname, created_at) values (${name}, now() - make_interval(days => ${ageDays})) returning id`)
  users.push(rows[0]!.id)
  return rows[0]!.id
}
/** An auction row straight in (no cards or points needed for the badge) */
async function auction(sellerId: string | null, status: (typeof AUCTION_STATUSES)[number], buyer: string | null = null) {
  const closed = status === 'open' ? null : sql`now()`
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into account.auctions (seller_id, card_id, start_price, min_step, status, ends_at, original_ends_at, top_amount, top_bidder_id, bid_count, idem_key, closed_at)
    values (${sellerId}, 'me5-1', 100, 100, ${status}, now() + interval '1 hour', now() + interval '1 hour',
            ${status === 'sold' || buyer ? 100 : null}, ${buyer}, ${buyer ? 1 : 0}, ${`k${randomUUID().replaceAll('-', '').slice(0, 20)}`}, ${closed})
    returning id`)
  made.push(rows[0]!.id)
  return rows[0]!.id
}

try {
  const seller = await user('점검-판매자')
  const buyers = await Promise.all(Array.from({ length: 22 }, (_, i) => user(`점검-구매자${i}`)))

  // No sales yet; unsold, cancelled and open ones don't count
  const first = await auction(seller, 'unsold')
  await auction(seller, 'cancelled')
  await auction(seller, 'open', buyers[0]!)
  check('no sales → first', (await auctions.sellerBadge(first))?.badge === 'first')

  // Four sales to the same buyer count once (B-2)
  for (let i = 0; i < 4; i++) await auction(seller, 'sold', buyers[0]!)
  check('4 sales to one buyer → sold1', (await auctions.sellerBadge(first))?.badge === 'sold1')
  for (let i = 1; i < 5; i++) await auction(seller, 'sold', buyers[i]!)
  check('5 different buyers → sold5', (await auctions.sellerBadge(first))?.badge === 'sold5')
  for (let i = 5; i < 22; i++) await auction(seller, 'sold', buyers[i]!)
  check('22 different buyers → sold20 (capped)', (await auctions.sellerBadge(first))?.badge === 'sold20')

  // Another seller's sales never leak in; a buyer who left (NULL) doesn't count
  const other = await user('점검-다른판매자')
  const otherAuction = await auction(other, 'open')
  check('another seller is not mixed in', (await auctions.sellerBadge(otherAuction))?.badge === 'first')

  // New member by database time (B-4): 6 days → new, 8 days → not
  const fresh = await user('점검-새회원', 6)
  const freshAuction = await auction(fresh, 'open')
  check('6-day-old account → newMember', (await auctions.sellerBadge(freshAuction))?.newMember === true)
  check('30-day-old account → not new', (await auctions.sellerBadge(first))?.newMember === false)

  // The same query for the user's own badge (B-5)
  check('myBadge = the public badge', JSON.stringify(await auctions.myBadge(seller)) === JSON.stringify(await auctions.sellerBadge(first)))

  // A seller who left: the auction stays, no badge
  const leaving = await user('점검-탈퇴판매자')
  const orphan = await auction(leaving, 'unsold')
  await db.execute(sql`update account.auctions set seller_id = null where id = ${orphan}`)
  check('seller left → badge null', JSON.stringify(await auctions.sellerBadge(orphan)) === JSON.stringify({ badge: null, newMember: false }))

  // B-1: for every status (and a missing id) the badge exists exactly when the auction does
  for (const status of AUCTION_STATUSES) {
    const id = await auction(seller, status, status === 'sold' ? buyers[0]! : null)
    const detail = await auctions.get(id)
    const badge = await auctions.sellerBadge(id)
    check(`status ${status}: badge 200 ⇔ detail 200`, (detail === null) === (badge === null))
  }
  const missing = randomUUID()
  check('missing id: both 404', (await auctions.get(missing)) === null && (await auctions.sellerBadge(missing)) === null)
} finally {
  const list = `{${users.join(',')}}`
  await db.execute(sql`delete from account.auctions where id = any(${`{${made.join(',')}}`}::uuid[])`)
  await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  await pool.end()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
