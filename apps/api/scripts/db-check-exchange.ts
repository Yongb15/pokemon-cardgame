// 10 packs, exchange and craft against a real Postgres (the dev branch, as the owner), docs/auction/exchange.md and
// Security X-1..X-7: the function's grants seen as api_rw, its rules (one copy stays, listed and test copies never
// go), exchange racing an auction listing, 20 parallel 10-pack opens, idempotency, and the ledger invariant.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-exchange.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { PgAuctionsStore } from '../src/auctions/store.js'
import { BUNDLE_SIZE, EXCHANGE_VALUE, PACK_PRICE, PACK_SETS, tierOf } from '../src/packs/odds.js'
import { exchangeFunctionCheck, PgPacksStore } from '../src/packs/store.js'
import { PgPointsStore } from '../src/points/store.js'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER (the dev branch) is not set')
const pool = new pg.Pool({ connectionString: url, max: 25 })
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
const key = () => `k${Math.random().toString(36).slice(2, 14)}`
async function user(name: string, balance = 0) {
  const { rows } = await db.execute<{ id: string }>(sql`insert into account.users (nickname) values (${name}) returning id`)
  const id = rows[0]!.id
  users.push(id)
  await points.summary(id) // the account and the signup bonus
  if (balance) {
    await db.execute(sql`insert into account.point_entries (user_id, amount, kind, ref, idem_key) values (${id}, ${balance}, 'admin_adjust', 'test', ${`top:${key()}`})`)
    await db.execute(sql`update account.point_accounts set balance = balance + ${balance} where user_id = ${id}`)
  }
  return id
}
async function copies(userId: string, cardId: string) {
  const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from account.owned_cards where user_id = ${userId} and card_id = ${cardId}`)
  return rows[0]!.n
}
async function addCopies(userId: string, cardId: string, n: number, source = 'pack') {
  for (let i = 0; i < n; i++) await db.execute(sql`insert into account.owned_cards (user_id, card_id, source) values (${userId}, ${cardId}, ${source})`)
}
async function ledgerOk(label: string) {
  const list = `{${users.join(',')}}`
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from account.point_accounts a
    left join (select user_id, sum(amount) s from account.point_entries group by user_id) e on e.user_id = a.user_id
    where a.user_id = any(${list}::uuid[]) and a.balance <> coalesce(e.s, 0)`)
  check(`${label}: ledger sum = balance`, r.rows[0]!.n === 0)
}

const set = PACK_SETS[0]!
const common = set.tiers.common![0]!
try {
  // Grants as api_rw (X-1, X-2): EXECUTE yes, DELETE no, nothing wider
  const fn = await exchangeFunctionCheck(db, 'api_rw')
  const del = (await db.execute<{ d: boolean }>(sql`select has_table_privilege('api_rw', 'account.owned_cards', 'DELETE') as d`)).rows[0]!.d ? 'allowed' : 'refused'
  const asApi = { fn, del }
  check('as api_rw: function present, executable, definer settings right', asApi.fn.missing.length === 0, asApi.fn.missing.join(', '))
  check('as api_rw: nobody else may execute, owner is narrow', asApi.fn.excess.length === 0, asApi.fn.excess.join(', '))
  check('as api_rw: DELETE on owned_cards refused', asApi.del === 'refused')

  // The function's own rules (X-3): one copy stays, test and listed copies never go, bad arguments refused
  const u = await user('점검-교환', 0)
  await addCopies(u, common, 3)
  await addCopies(u, common, 2, 'test')
  const fnErr = (q: ReturnType<typeof sql>) => db.transaction(async (tx) => tx.execute(q)).then(() => 'ok', (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code ?? 'error')
  check('function: n = 4 with 3 real + 2 test copies → refused (test copies never count)', (await fnErr(sql`select account.exchange_cards(${u}::uuid, ${common}, 4)`)) === 'P0001')
  check('function: n = 0 or 51 → bad arguments', (await fnErr(sql`select account.exchange_cards(${u}::uuid, ${common}, 0)`)) === '22023' && (await fnErr(sql`select account.exchange_cards(${u}::uuid, ${common}, 51)`)) === '22023')
  check("function: a malformed card id → bad arguments", (await fnErr(sql`select account.exchange_cards(${u}::uuid, ${"x'; drop"}, 1)`)) === '22023')
  // One usable copy always stays: test copies don't count as the one kept (Security I-x1)
  check('3 real + 2 test: all 3 real → refused, 2 available', JSON.stringify(await packs.exchange(u, common, 3, key())) === JSON.stringify({ kind: 'too_many', available: 2 }))
  check('function: n = 3 here → refused too', (await fnErr(sql`select account.exchange_cards(${u}::uuid, ${common}, 3)`)) === 'P0001')
  const ex1 = await packs.exchange(u, common, 2, key())
  check('exchange 2 of the 3 real → ok', ex1.kind === 'ok' && ex1.points === 2 * EXCHANGE_VALUE.common, JSON.stringify(ex1))
  check('after: 1 real + 2 test copies stay', (await copies(u, common)) === 3)
  const ex2 = await packs.exchange(u, common, 1, key())
  check('one usable copy left → nothing to exchange', ex2.kind === 'too_many' && ex2.available === 0, JSON.stringify(ex2))
  // A listed copy isn't the one kept either: 2 real, 1 listed → nothing to exchange
  const lu = await user('점검-교환경매', 0)
  await addCopies(lu, common, 2)
  const listed = await auctions.list(lu, common, 100, 60, key())
  const lx = await packs.exchange(lu, common, 1, key())
  check('2 copies, 1 listed → refused, 0 available', listed.kind === 'listed' && lx.kind === 'too_many' && lx.available === 0, JSON.stringify(lx))

  // One copy always stays
  const u2 = await user('점검-교환2', 0)
  await addCopies(u2, common, 2)
  check('2 copies, exchange 2 → refused, 1 available', JSON.stringify(await packs.exchange(u2, common, 2, key())) === JSON.stringify({ kind: 'too_many', available: 1 }))
  const k = key()
  const once = await packs.exchange(u2, common, 1, k)
  const again = await packs.exchange(u2, common, 1, k)
  check('exchange 1 → ok; same key again → repeat, no second credit', once.kind === 'ok' && again.kind === 'repeat' && (await copies(u2, common)) === 1)
  check('not a pool card → not_found', (await packs.exchange(u2, 'nope-1', 1, key())).kind === 'not_found')

  // Exchange racing an auction listing on the last-but-one copy (X-4), ×10: never 0 copies, never a listed copy deleted
  let raceErrors = 0
  for (let i = 0; i < 10; i++) {
    const r = await user(`점검-경합${i}`, 0)
    await addCopies(r, common, 2)
    const res = await Promise.allSettled([packs.exchange(r, common, 1, key()), auctions.list(r, common, 100, 60, key())])
    raceErrors += res.filter((x) => x.status === 'rejected').length
    const left = await copies(r, common)
    const listedGone = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from account.auctions a where a.seller_id = ${r} and a.status = 'open'
        and not exists (select 1 from account.owned_cards o where o.id = a.owned_card_id)`)
    check(`race ${i + 1}: ${left} cop${left === 1 ? 'y' : 'ies'} left, no listed copy deleted`, left >= 1 && listedGone.rows[0]!.n === 0)
  }
  check('races: no errors', raceErrors === 0)

  // 10 packs: 10,000P, 50 cards, guarantee, idempotency, key collision (X-5)
  const b = await user('점검-10팩', 30_000)
  const bk = key()
  const opened = await packs.open(b, set.id, bk, 10)
  check('10 packs → 10 packs, 50 cards', opened.kind === 'opened' && opened.packs.length === BUNDLE_SIZE && opened.packs.flat().length === BUNDLE_SIZE && opened.packs.every((p) => p.cards.length === 5))
  check('an ultra or better among them', opened.kind === 'opened' && opened.packs.some((p) => p.cards.some((c) => ['ultra', 'sir', 'hyper'].includes(c.tier))))
  const replay = await packs.open(b, set.id, bk, 10)
  check('same key, 10 again → the same packs', replay.kind === 'repeat' && opened.kind === 'opened' && replay.packs.map((p) => p.id).join() === opened.packs.map((p) => p.id).join())
  check('same key, 1 pack → conflict', (await packs.open(b, set.id, bk, 1)).kind === 'conflict')
  const single = key()
  await packs.open(b, set.id, single, 1)
  check('a single key, then 10 with it → conflict', (await packs.open(b, set.id, single, 10)).kind === 'conflict')
  const bal = await points.summary(b)
  check('charged 10,000 + 1,000', bal.balance === 10_000 + 30_000 - 11 * PACK_PRICE, String(bal.balance))

  // 20 parallel 10-packs with money for 3: exactly 3 open, no negative balance
  const p = await user('점검-동시', 20_000) // + 10,000 signup = 30,000
  const many = await Promise.allSettled(Array.from({ length: 20 }, () => packs.open(p, set.id, key(), 10)))
  const ok = many.filter((r) => r.status === 'fulfilled' && r.value.kind === 'opened').length
  const errs = many.filter((r) => r.status === 'rejected').length
  check(`20 parallel 10-packs with 30,000P: ${ok} opened, ${errs} errors`, ok === 3 && errs === 0)
  check('balance not negative', (await points.summary(p)).balance >= 0)

  // Craft: pool card, cost, insufficient, idempotent
  const c = await user('점검-제작', 0)
  const rare = set.tiers.rare![0]!
  const craftCost = EXCHANGE_VALUE[tierOf(rare)!] * 10
  const ck = key()
  const made = await packs.craft(c, rare, ck)
  check(`craft a rare → ${craftCost}P, one copy`, made.kind === 'ok' && made.cost === craftCost && (await copies(c, rare)) === 1)
  check('same key → repeat, no second copy', (await packs.craft(c, rare, ck)).kind === 'repeat' && (await copies(c, rare)) === 1)
  check('not a pool card → not_found', (await packs.craft(c, 'nope-1', key())).kind === 'not_found')
  const hyper = set.tiers.hyper![0]!
  check('a hyper with 9,000P → insufficient', (await packs.craft(c, hyper, key())).kind === 'insufficient')
  await ledgerOk('after everything')
} finally {
  const list = `{${users.join(',')}}`
  await db.execute(sql`delete from account.auctions where seller_id = any(${list}::uuid[])`)
  await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  await pool.end()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
