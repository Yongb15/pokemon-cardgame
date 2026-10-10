// Auction concurrency checks against a real Postgres (the dev branch, as the owner): the design's
// §4 tests (Security). Throwaway users, removed at the end. Prints counts and invariants only.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-auctions.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { fee, PgAuctionsStore } from '../src/auctions/store.js'
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
const users: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const key = (p: string) => `${p}-${Math.random().toString(36).slice(2, 12)}`

async function user(name: string, balance: number) {
  const { rows } = await db.execute<{ id: string }>(sql`insert into account.users (nickname) values (${name}) returning id`)
  const id = rows[0]!.id
  users.push(id)
  await points.summary(id) // first bonus 10,000
  if (balance !== 10_000) await points.adjust(id, balance - 10_000, key('adj'))
  return id
}

/** A seller with one listed card; returns the auction id */
async function listing(seller: string, minutes = 60, start = 100) {
  await packs.open(seller, 'me5', key('pack'))
  const { rows } = await db.execute<{ card_id: string }>(sql`select card_id from account.owned_cards where user_id = ${seller} and auction_id is null limit 1`)
  const r = await auctions.list(seller, rows[0]!.card_id, start, minutes, key('list'))
  if (r.kind !== 'listed') throw new Error(`listing failed: ${r.kind}`)
  return r.auctionId
}

async function invariants(label: string) {
  const mism = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from account.point_accounts a
    left join (select user_id, sum(amount) s from account.point_entries group by user_id) e on e.user_id = a.user_id
    where a.user_id = any(${`{${users.join(',')}}`}::uuid[]) and a.balance <> coalesce(e.s, 0)`)
  const held = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from account.point_accounts a
    where a.user_id = any(${`{${users.join(',')}}`}::uuid[])
      and a.held <> coalesce((select sum(top_amount) from account.auctions x where x.top_bidder_id = a.user_id and x.status = 'open'), 0)`)
  check(`${label}: ledger sum = balance`, mism.rows[0]!.n === 0)
  check(`${label}: held = own open top bids`, held.rows[0]!.n === 0)
}

try {
  // 1. Normal life: bid, outbid, raise, settle — amounts and the fee
  {
    const seller = await user('점검-판매', 10_000)
    const a = await user('점검-A', 10_000)
    const b = await user('점검-B', 10_000)
    const id = await listing(seller, 60, 1_000)
    check('own bid refused', (await auctions.bid(seller, id, 1_000, key('b'))).kind === 'own')
    check('below start refused', (await auctions.bid(a, id, 900, key('b'))).kind === 'too_low')
    check('A bids 1,000', (await auctions.bid(a, id, 1_000, key('b'))).kind === 'ok')
    check('B bids 1,500', (await auctions.bid(b, id, 1_500, key('b'))).kind === 'ok')
    check('B raises to 2,000', (await auctions.bid(b, id, 2_000, key('b'))).kind === 'ok')
    const state = await auctions.get(id)
    check('aliases per auction', state!.bids.map((x) => x.alias).join(',') === '입찰자 B,입찰자 B,입찰자 A', state!.bids.map((x) => x.alias).join(','))
    check('no user ids in the public state', !JSON.stringify(state).includes(seller) && !JSON.stringify(state).includes(b))
    await invariants('after bids')
    await db.execute(sql`update account.auctions set ends_at = now() - interval '1 second' where id = ${id}`)
    check('settled once', (await auctions.settleExpired(10, b)) === 1 && (await auctions.settleExpired(10, b)) === 0)
    const sum = await points.summary(seller)
    check('seller gets price − 5% fee', sum.balance === 9_000 + 2_000 - fee(2_000), `${sum.balance}`)
    const card = await db.execute<{ user_id: string; auction_id: string | null }>(sql`select o.user_id, o.auction_id from account.owned_cards o join account.auctions x on x.owned_card_id = o.id where x.id = ${id}`)
    check('card moved to the winner and freed', card.rows[0]!.user_id === b && card.rows[0]!.auction_id === null)
    await invariants('after settlement')
  }

  // 2. Bid racing the lazy settlement at ends_at: one outcome, no deadlock
  {
    const seller = await user('점검-판매2', 10_000)
    const c = await user('점검-C', 10_000)
    const id = await listing(seller, 60, 100)
    await auctions.bid(c, id, 100, key('b'))
    await db.execute(sql`update account.auctions set ends_at = now() + interval '300 milliseconds' where id = ${id}`)
    await new Promise((r) => setTimeout(r, 300))
    const results = await Promise.allSettled([auctions.bid(c, id, 500, key('b')), auctions.settleExpired(5), auctions.get(id), auctions.bid(c, id, 600, key('b'))])
    const errors = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason))
    check('ends_at race: no errors (no 40P01)', errors.length === 0, errors.join(','))
    const final = await auctions.get(id)
    check('ends_at race: closed exactly once', final!.status === 'sold' || final!.status === 'open', final!.status)
    await invariants('after the ends_at race')
  }

  // 3. Leave racing a bid by the same user: never both
  {
    const seller = await user('점검-판매3', 10_000)
    const d = await user('점검-D', 10_000)
    const id = await listing(seller, 60, 100)
    const [bid, leave] = await Promise.allSettled([auctions.bid(d, id, 300, key('b')), auctions.leave(d)])
    const bidOk = bid.status === 'fulfilled' && bid.value.kind === 'ok'
    const left = leave.status === 'fulfilled' && leave.value.kind === 'deleted'
    check('leave vs bid: not both', !(bidOk && left), `bid ${bid.status === 'fulfilled' ? bid.value.kind : 'error'}, leave ${leave.status === 'fulfilled' ? leave.value.kind : 'error'}`)
    if (left) users.splice(users.indexOf(d), 1)
    const blocked = await auctions.leave(seller)
    check('seller with an open auction cannot leave', blocked.kind === 'blocked')
    await invariants('after leave vs bid')
  }

  // 4. 50 parallel bids across 2 auctions, overlapping bidders: no deadlock, invariants hold
  {
    const s1 = await user('점검-판매4', 10_000)
    const s2 = await user('점검-판매5', 10_000)
    const bidders = await Promise.all(Array.from({ length: 5 }, (_, i) => user(`점검-입찰${i}`, 50_000)))
    const ids = [await listing(s1, 60, 100), await listing(s2, 60, 100)]
    const tries = Array.from({ length: 50 }, (_, i) => auctions.bid(bidders[i % 5]!, ids[i % 2]!, 100 + i * 100, key('p')))
    const settled = await Promise.allSettled(tries)
    const deadlocks = settled.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.cause?.code === '40P01').length
    const errors = settled.filter((r) => r.status === 'rejected').length
    const kinds = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value.kind] : []))
    check('50 parallel bids: no deadlocks', deadlocks === 0, `${deadlocks} × 40P01`)
    check('50 parallel bids: no other errors', errors === 0, `${errors}`)
    console.log(`     outcomes: ${Object.entries(kinds.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ×${n}`).join(', ')}`)
    await invariants('after 50 parallel bids')
  }
} finally {
  if (users.length) {
    // Owner cleanup of the throwaway data (api_rw never deletes these rows)
    await db.execute(sql`delete from account.bids where auction_id in (select id from account.auctions where seller_id = any(${`{${users.join(',')}}`}::uuid[]))`)
    await db.execute(sql`update account.owned_cards set auction_id = null where user_id = any(${`{${users.join(',')}}`}::uuid[])`)
    await db.execute(sql`delete from account.auctions where seller_id = any(${`{${users.join(',')}}`}::uuid[])`)
    await db.execute(sql`delete from account.users where id = any(${`{${users.join(',')}}`}::uuid[])`)
  }
  await pool.end()
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  if (failures) process.exitCode = 1
}
