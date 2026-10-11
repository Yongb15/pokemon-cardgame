// Auction watch checks against a real Postgres (the dev branch, as the owner): the 100 limit, closed
// auctions refused, and the lazy watch notices (who gets them, once per new bid, ending-soon once).
// Throwaway users, removed at the end. Prints counts only.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-watch.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { MAX_WATCHES, PgAuctionsStore } from '../src/auctions/store.js'
import { PgNotificationsStore } from '../src/notifications/store.js'
import { PgPacksStore } from '../src/packs/store.js'
import { PgPointsStore } from '../src/points/store.js'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER (the dev branch) is not set')
const pool = new pg.Pool({ connectionString: url, max: 20 })
const db = drizzle(pool)
const isDev = await db.execute(sql`select 1 from public.dev_marker limit 1`).then(
  () => true,
  () => false,
)
if (!isDev) throw new Error('refusing: not the dev branch (no dev_marker)')

const points = new PgPointsStore(db)
const packs = new PgPacksStore(db)
const auctions = new PgAuctionsStore(db)
const notes = new PgNotificationsStore(db)
const users: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const key = (p: string) => `${p}-${Math.random().toString(36).slice(2, 12)}`
async function user(name: string) {
  const { rows } = await db.execute<{ id: string }>(sql`insert into account.users (nickname) values (${name}) returning id`)
  users.push(rows[0]!.id)
  await points.summary(rows[0]!.id)
  return rows[0]!.id
}
async function listing(seller: string, minutes = 60) {
  await packs.open(seller, 'me5', key('pack'))
  const { rows } = await db.execute<{ card_id: string }>(sql`select card_id from account.owned_cards where user_id = ${seller} and auction_id is null limit 1`)
  const r = await auctions.list(seller, rows[0]!.card_id, 100, minutes, key('list'))
  if (r.kind !== 'listed') throw new Error(`listing failed: ${r.kind}`)
  return r.auctionId
}
const kinds = async (u: string, kind: string) => (await notes.list(u)).items.filter((i) => i.kind === kind)

try {
  const seller = await user('점검-찜판매')
  const watcher = await user('점검-찜')
  const bidder = await user('점검-찜입찰A')
  const other = await user('점검-찜입찰B')
  const id = await listing(seller)

  // Watch rules
  check('watch an open auction', (await auctions.watch(watcher, id)) === 'ok' && (await auctions.watch(watcher, id)) === 'ok')
  check('watch an unknown auction → not_found', (await auctions.watch(watcher, '00000000-0000-4000-8000-000000000000')) === 'not_found')
  await auctions.watch(seller, id) // own auction: allowed, never notified
  await auctions.watch(bidder, id) // will bid: never notified
  check('mine.watching', (await auctions.mine(id, watcher)).watching && !(await auctions.mine(id, other)).watching)

  // No bid yet: nothing
  await auctions.watchNotices(watcher)
  check('no bids → no watch_bid', (await kinds(watcher, 'watch_bid')).length === 0)

  // A bid: the watcher hears once; the seller and the bidder don't
  await auctions.bid(bidder, id, 100, key('b'))
  for (const u of [watcher, seller, bidder]) await auctions.watchNotices(u)
  const w1 = await kinds(watcher, 'watch_bid')
  check('new bid → one watch_bid with the price', w1.length === 1 && w1[0]!.amount === 100 && !w1[0]!.read)
  check('seller and bidder get no watch_bid', (await kinds(seller, 'watch_bid')).length === 0 && (await kinds(bidder, 'watch_bid')).length === 0)
  check('no user ids in it', !JSON.stringify(w1).includes(bidder) && !JSON.stringify(w1).includes(seller))
  await notes.markRead(watcher)
  await auctions.watchNotices(watcher)
  check('reading again without a new bid writes nothing', (await notes.list(watcher)).unread === 0)

  // Another bid: the same row comes back unread with the new price
  await auctions.bid(other, id, 200, key('b'))
  await auctions.watchNotices(watcher)
  const w2 = await kinds(watcher, 'watch_bid')
  check('next bid → same row, unread, new price', w2.length === 1 && w2[0]!.amount === 200 && !w2[0]!.read)

  // Ending soon: once, even when the read repeats or the end moves
  check('not ending yet → no watch_ending', (await kinds(watcher, 'watch_ending')).length === 0)
  await db.execute(sql`update account.auctions set ends_at = now() + interval '10 minutes' where id = ${id}`)
  await auctions.watchNotices(watcher)
  await auctions.watchNotices(watcher)
  check('ending within 30 min → one watch_ending', (await kinds(watcher, 'watch_ending')).length === 1)
  check('the seller watching their own gets no watch_ending', (await auctions.watchNotices(seller)) === 0 && (await kinds(seller, 'watch_ending')).length === 0)

  // Unwatch, the limit, closed auctions
  await auctions.unwatch(watcher, id)
  check('unwatch', !(await auctions.mine(id, watcher)).watching)
  const filler = await user('점검-찜한도')
  const ids = (await db.execute<{ id: string }>(sql`select id from account.auctions where status = 'open' and now() < ends_at limit ${MAX_WATCHES + 1}`)).rows.map((r) => r.id)
  if (ids.length > MAX_WATCHES) {
    const results = await Promise.all(ids.map((a) => auctions.watch(filler, a)))
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from account.auction_watches where user_id = ${filler}`)
    check(`at most ${MAX_WATCHES} watches under parallel requests`, rows[0]!.n === MAX_WATCHES && results.filter((r) => r === 'limit').length === 1)
  } else {
    console.log(`     (limit check skipped: only ${ids.length} open auctions on the dev branch)`)
  }
  await db.execute(sql`update account.auctions set starts_at = now() - interval '2 seconds', ends_at = now() - interval '1 second' where id = ${id}`)
  check('watching an ended auction → closed', (await auctions.watch(other, id)) === 'closed')

  // Account deletion takes the watches along
  await db.execute(sql`delete from account.users where id = ${watcher}`)
  const left = await db.execute<{ n: number }>(sql`select count(*)::int as n from account.auction_watches where user_id = ${watcher}`)
  check('account deletion removes watches', left.rows[0]!.n === 0)
} finally {
  if (users.length) {
    const list = `{${users.join(',')}}`
    await db.execute(sql`delete from account.auction_watches where user_id = any(${list}::uuid[]) or auction_id in (select id from account.auctions where seller_id = any(${list}::uuid[]))`)
    await db.execute(sql`delete from account.notifications where auction_id in (select id from account.auctions where seller_id = any(${list}::uuid[]))`)
    await db.execute(sql`delete from account.bids where auction_id in (select id from account.auctions where seller_id = any(${list}::uuid[]))`)
    await db.execute(sql`update account.owned_cards set auction_id = null where user_id = any(${list}::uuid[])`)
    await db.execute(sql`delete from account.auctions where seller_id = any(${list}::uuid[])`)
    await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  }
  await pool.end()
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  if (failures) process.exitCode = 1
}
