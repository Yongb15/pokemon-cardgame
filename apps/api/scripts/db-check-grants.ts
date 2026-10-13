// Admin point grant checks against a real Postgres (the dev branch, as the owner), Security G-1..G-4:
// member codes, the daily limit under 20 parallel grants, idempotency per admin, admins as targets,
// a granted user leaving (the record stays, unlinked), and the ledger invariant. Throwaway users.
//
//   cd apps/api && node --env-file=../../.env ../../node_modules/tsx/dist/cli.mjs scripts/db-check-grants.ts

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { PgAuctionsStore } from '../src/auctions/store.js'
import { GRANT_DAILY_MAX, PgGrantsStore } from '../src/moderation/grants.js'
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
const grants = new PgGrantsStore(db)
const auctions = new PgAuctionsStore(db)
const users: string[] = []
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const key = () => `k${Math.random().toString(36).slice(2, 14)}`
async function user(name: string) {
  const { rows } = await db.execute<{ id: string; member_code: string }>(sql`insert into account.users (nickname) values (${name}) returning id, member_code`)
  users.push(rows[0]!.id)
  await points.summary(rows[0]!.id)
  return { id: rows[0]!.id, code: rows[0]!.member_code }
}
async function ledgerOk(label: string) {
  const list = `{${users.join(',')}}`
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from account.point_accounts a
    left join (select user_id, sum(amount) s from account.point_entries group by user_id) e on e.user_id = a.user_id
    where a.user_id = any(${list}::uuid[]) and a.balance <> coalesce(e.s, 0)`)
  check(`${label}: ledger sum = balance`, r.rows[0]!.n === 0)
}

let admin = ''
let admin2 = ''
try {
  // Member codes: every user has one, 8 upper hex, unique
  const codes = await db.execute<{ bad: number; dup: number }>(sql`
    select count(*) filter (where member_code !~ '^[0-9A-F]{8}$')::int as bad,
           (count(*) - count(distinct member_code))::int as dup from account.users`)
  check('member codes: all present, 8 upper hex, unique', codes.rows[0]!.bad === 0 && codes.rows[0]!.dup === 0, JSON.stringify(codes.rows[0]))

  const a = await user('점검-관리자')
  const a2 = await user('점검-관리자2')
  admin = a.id
  admin2 = a2.id
  await db.execute(sql`insert into account.admins (user_id) values (${admin}), (${admin2})`)
  const target = await user('점검-대상')

  // Lookup
  const found = await grants.member(target.code)
  check('lookup by code', found?.userId === target.id && found.nickname === '점검-대상')
  check('unknown code', (await grants.member('00000000')) === null || (await grants.member('00000000'))?.userId !== target.id)

  // A grant, its ledger row (admin_adjust, ref grant) and record
  const k1 = key()
  const g1 = await grants.grant(admin, target.code, 30_000, '점검 지급', k1)
  check('grant ok', g1.kind === 'ok' && !g1.replay, JSON.stringify(g1))
  const entry = await db.execute<{ kind: string; ref: string; amount: string }>(sql`
    select e.kind, e.ref, e.amount from account.admin_point_grants g join account.point_entries e on e.id = g.entry_id
    where g.idem_key = ${k1}`)
  check('ledger row admin_adjust/grant', entry.rows[0]?.kind === 'admin_adjust' && entry.rows[0]?.ref === 'grant' && Number(entry.rows[0]?.amount) === 30_000)

  // Idempotency per admin (G-2)
  const replay = await grants.grant(admin, target.code, 30_000, '점검 지급', k1)
  check('same key, same grant → first result, no second credit', replay.kind === 'ok' && replay.replay && g1.kind === 'ok' && replay.grantId === g1.grantId)
  const other = await user('점검-다른대상')
  check('same key, other member → conflict', (await grants.grant(admin, other.code, 30_000, '점검', k1)).kind === 'idem_conflict')
  check('same key, other amount → conflict', (await grants.grant(admin, target.code, 1, '점검', k1)).kind === 'idem_conflict')
  check('same key from another admin is its own grant', (await grants.grant(admin2, target.code, 1, '점검', k1)).kind === 'ok')

  // Admins can't be targets (R-1), self included
  check('to self → admin_target', (await grants.grant(admin, a.code, 1, '점검', key())).kind === 'admin_target')
  check('to another admin → admin_target', (await grants.grant(admin, a2.code, 1, '점검', key())).kind === 'admin_target')
  check('unknown code → not_found', (await grants.grant(admin, '00000000', 1, '점검', key())).kind === 'not_found')

  // Daily limit under 20 parallel grants of 30,000 (30,000 already today): at most 500,000 in total (G-3)
  const many = await Promise.all(Array.from({ length: 20 }, () => grants.grant(admin, target.code, 30_000, '동시 점검', key())))
  const oks = many.filter((r) => r.kind === 'ok').length
  const limits = many.filter((r) => r.kind === 'limit').length
  const sum = await db.execute<{ n: string }>(sql`
    select coalesce(sum(amount), 0) as n from account.admin_point_grants
    where admin_id = ${admin} and created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`)
  check(
    `20 parallel × 30,000: ${oks} granted, ${limits} over the limit, today's total ≤ ${GRANT_DAILY_MAX}`,
    Number(sum.rows[0]!.n) <= GRANT_DAILY_MAX && oks === 15 && limits === 5,
    `total ${sum.rows[0]!.n}`,
  )
  const exact = await grants.grant(admin, target.code, GRANT_DAILY_MAX - Number(sum.rows[0]!.n), '정확히 한도', key())
  check('up to exactly the limit → ok', exact.kind === 'ok', JSON.stringify(exact))
  check('one more point → limit', (await grants.grant(admin, target.code, 1, '초과', key())).kind === 'limit')
  await ledgerOk('after the grants')

  // The granted user leaves (G-1): no error, the record stays with user_id and entry_id null
  const leaver = await user('점검-탈퇴')
  const gl = await grants.grant(admin2, leaver.code, 500, '탈퇴 점검', key())
  check('grant before leaving', gl.kind === 'ok')
  const left = await auctions.leave(leaver.id)
  check('the granted user can leave', left.kind === 'deleted', JSON.stringify(left))
  const kept = await db.execute<{ user_id: string | null; entry_id: string | null; amount: number }>(sql`
    select user_id, entry_id, amount from account.admin_point_grants where id = ${gl.kind === 'ok' ? gl.grantId : null}`)
  check('the record stays, unlinked', kept.rows[0]?.user_id === null && kept.rows[0]?.entry_id === null && kept.rows[0]?.amount === 500)
  check('the left code is not found', (await grants.member(leaver.code)) === null)

  // Leaving × a grant to the same user, at once (R-6): one wins, nothing breaks
  for (let i = 0; i < 5; i++) {
    const racer = await user(`점검-경합${i}`)
    const res = await Promise.allSettled([grants.grant(admin2, racer.code, 100, '경합', key()), auctions.leave(racer.id)])
    const errs = res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))
    check(`grant × leave ${i + 1}: no errors`, errs.length === 0, errs.join(','))
  }
  await ledgerOk('after the races')

  // Reasons are cleared after a year (R-3): backdate one and run the cleanup
  await db.execute(sql`update account.admin_point_grants set created_at = now() - interval '366 days' where idem_key = ${k1} and admin_id = ${admin}`)
  const cleared = await grants.clearOldReasons()
  const after = await db.execute<{ reason: string | null; amount: number }>(sql`select reason, amount from account.admin_point_grants where idem_key = ${k1} and admin_id = ${admin}`)
  check('old reasons cleared, amount kept', cleared >= 1 && after.rows[0]?.reason === null && after.rows[0]?.amount === 30_000)
} finally {
  const list = `{${users.join(',')}}`
  await db.execute(sql`delete from account.admin_point_grants where admin_id = any(${list}::uuid[]) or user_id = any(${list}::uuid[])`)
  await db.execute(sql`delete from account.admins where user_id = any(${list}::uuid[])`)
  await db.execute(sql`delete from account.users where id = any(${list}::uuid[])`)
  await pool.end()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
