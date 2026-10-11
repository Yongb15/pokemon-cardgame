// Moderation checks against a real Postgres (the dev branch, as the owner), Security AD-4: report rules,
// removing an auction with bids (held released, card back, no ledger rows), conflicts, and the races
// remove × bid, remove × settlement at the end, remove × the top bidder leaving. Throwaway users.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-moderation.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { PgAuctionsStore } from '../src/auctions/store.js'
import { PgModerationStore, REPORTS_PER_DAY } from '../src/moderation/store.js'
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
const mod = new PgModerationStore(db)
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
/** held = own open top bids, ledger sum = balance, for these users */
async function invariants(label: string) {
  const list = `{${users.join(',')}}`
  const r = await db.execute<{ held: number; ledger: number }>(sql`
    select (select count(*) from account.point_accounts a where a.user_id = any(${list}::uuid[])
              and a.held <> coalesce((select sum(top_amount) from account.auctions x where x.top_bidder_id = a.user_id and x.status = 'open'), 0))::int as held,
           (select count(*) from account.point_accounts a left join (select user_id, sum(amount) s from account.point_entries group by user_id) e on e.user_id = a.user_id
              where a.user_id = any(${list}::uuid[]) and a.balance <> coalesce(e.s, 0))::int as ledger`)
  check(`${label}: held = own open top bids, ledger = balance`, r.rows[0]!.held === 0 && r.rows[0]!.ledger === 0, JSON.stringify(r.rows[0]))
}

try {
  const admin = await user('점검-관리')
  await db.execute(sql`insert into account.admins (user_id) values (${admin})`)
  const seller = await user('점검-신고판매')
  const bidder = await user('점검-신고입찰')
  const reporter = await user('점검-신고자')

  // Reports
  const id = await listing(seller)
  check('own auction → own', (await mod.report(seller, id, 'rmt', null)) === 'own')
  check('report → ok, repeat → repeat', (await mod.report(reporter, id, 'price_manipulation', '번갈아 올림')) === 'ok' && (await mod.report(reporter, id, 'rmt', null)) === 'repeat')
  check('unknown auction → not_found', (await mod.report(reporter, '00000000-0000-4000-8000-000000000000', 'rmt', null)) === 'not_found')
  // Sellers have a 10-open cap: spread the targets over a few sellers first, then report in parallel
  const sellers = [await user('점검-신고판매2'), await user('점검-신고판매3')]
  const targets: string[] = []
  for (let i = 0; i < REPORTS_PER_DAY + 2; i++) targets.push(await listing(sellers[i % 2]!))
  const many = (await Promise.allSettled(targets.map((t) => mod.report(reporter, t, 'other', null)))).map((x) => (x.status === 'fulfilled' ? x.value : 'error'))
  check(`at most ${REPORTS_PER_DAY} reports a day under parallel requests`, many.filter((r) => r === 'ok').length === REPORTS_PER_DAY - 1 && many.filter((r) => r === 'limit').length === 3, many.join(','))
  check('isAdmin', (await mod.isAdmin(admin)) && !(await mod.isAdmin(reporter)))

  // Admin view: reporters stay numbers; bids carry the given pseudonym, never ids
  await auctions.bid(bidder, id, 500, key('b'))
  const view = await mod.auction(id, (u) => `P(${u === bidder ? 'b' : 's'})`)
  check('admin view: reporter number, bid pseudonym, no ids', view!.reports[0]!.reporter === '신고자 1' && view!.bids[0]!.pseudonym === 'P(b)' && !JSON.stringify(view).includes(bidder))

  // Conflict: the admin bid here
  const id2 = await listing(seller)
  await auctions.bid(admin, id2, 100, key('b'))
  check('admin who bid → conflict', (await mod.remove(admin, id2, '테스트')) === 'conflict' && (await mod.dismiss(admin, id2, '테스트')) === 'conflict')

  // Remove with a bid: held released, card back, reports actioned, notices, no ledger rows
  const entriesBefore = (await db.execute<{ n: number }>(sql`select count(*)::int as n from account.point_entries where ref = ${id}`)).rows[0]!.n
  check('remove → ok', (await mod.remove(admin, id, '조작 확인')) === 'ok')
  const after = await db.execute<{ status: string; held: number; card_free: boolean; open_reports: number; notices: number; entries: number }>(sql`
    select (select status from account.auctions where id = ${id}) as status,
           (select held from account.point_accounts where user_id = ${bidder})::int as held,
           (select auction_id is null from account.owned_cards where id = (select owned_card_id from account.auctions where id = ${id})) as card_free,
           (select count(*) from account.auction_reports where auction_id = ${id} and status = 'open')::int as open_reports,
           (select count(*) from account.notifications where auction_id = ${id} and kind = 'removed')::int as notices,
           (select count(*) from account.point_entries where ref = ${id})::int as entries`)
  const r = after.rows[0]!
  check('removed: cancelled, held 0, card free, reports actioned, 2 notices, no ledger rows', r.status === 'cancelled' && r.held === 0 && r.card_free && r.open_reports === 0 && r.notices === 2 && r.entries === entriesBefore, JSON.stringify(r))
  check('remove again → closed', (await mod.remove(admin, id, '다시')) === 'closed')
  await invariants('after removal')

  // Race 1: remove × bid
  for (let i = 0; i < 3; i++) {
    const a = await listing(seller)
    await auctions.bid(bidder, a, 100, key('b'))
    const res = await Promise.allSettled([mod.remove(admin, a, '경합'), auctions.bid(reporter, a, 300, key('b'))])
    const errs = res.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.cause?.code ?? (x as PromiseRejectedResult).reason))
    check(`remove × bid ${i + 1}: no errors`, errs.length === 0, errs.join(','))
  }
  await invariants('after remove × bid')

  // Race 2: remove × settlement at the end
  for (let i = 0; i < 3; i++) {
    const a = await listing(seller)
    await auctions.bid(bidder, a, 100, key('b'))
    await db.execute(sql`update account.auctions set ends_at = now() + interval '300 milliseconds' where id = ${a}`)
    await new Promise((res) => setTimeout(res, 280))
    const res = await Promise.allSettled([mod.remove(admin, a, '경합'), auctions.settleExpired(5), auctions.get(a)])
    const errs = res.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.cause?.code ?? (x as PromiseRejectedResult).reason))
    const final = (await db.execute<{ status: string }>(sql`select status from account.auctions where id = ${a}`)).rows[0]!.status
    check(`remove × settle ${i + 1}: one outcome, no errors`, errs.length === 0 && ['cancelled', 'sold', 'open'].includes(final), `${final} ${errs.join(',')}`)
  }
  await invariants('after remove × settle')

  // Race 3: remove × the top bidder leaving
  for (let i = 0; i < 3; i++) {
    const leaver = await user(`점검-탈퇴${i}`)
    const a = await listing(seller)
    await auctions.bid(leaver, a, 100, key('b'))
    const res = await Promise.allSettled([mod.remove(admin, a, '경합'), auctions.leave(leaver)])
    const errs = res.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.cause?.code ?? (x as PromiseRejectedResult).reason))
    const left = res[1].status === 'fulfilled' ? res[1].value.kind : 'error'
    check(`remove × leave ${i + 1}: no errors (leave ${left})`, errs.length === 0, errs.join(','))
  }
  await invariants('after remove × leave')

  // Dismiss, and the note clean-up after 90 days
  const id3 = await listing(seller)
  await mod.report(bidder, id3, 'rmt', '연락처 abc')
  check('dismiss → ok, then nothing', (await mod.dismiss(admin, id3, '문제 없음')) === 'ok' && (await mod.dismiss(admin, id3, '문제 없음')) === 'nothing')
  await db.execute(sql`update account.auction_reports set resolved_at = now() - interval '91 days' where auction_id = ${id3}`)
  await mod.clearOldNotes()
  const note = (await db.execute<{ note: string | null }>(sql`select note from account.auction_reports where auction_id = ${id3}`)).rows[0]!.note
  check('notes cleared 90 days after resolution', note === null)
  const log = (await db.execute<{ n: number }>(sql`select count(*)::int as n from account.admin_actions where admin_id = ${admin}`)).rows[0]!.n
  check('admin actions logged', log >= 2, `${log}`)
} finally {
  if (users.length) {
    const list = `{${users.join(',')}}`
    const mine = sql`select id from account.auctions where seller_id = any(${list}::uuid[])`
    await db.execute(sql`delete from account.admin_actions where auction_id in (${mine})`)
    await db.execute(sql`delete from account.auction_reports where auction_id in (${mine})`)
    await db.execute(sql`delete from account.auction_watches where auction_id in (${mine})`)
    await db.execute(sql`delete from account.notifications where auction_id in (${mine})`)
    await db.execute(sql`delete from account.bids where auction_id in (${mine})`)
    await db.execute(sql`update account.owned_cards set auction_id = null where user_id = any(${list}::uuid[])`)
    await db.execute(sql`delete from account.auctions where seller_id = any(${list}::uuid[])`)
    await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  }
  await pool.end()
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  if (failures) process.exitCode = 1
}
