// Shows what the API role can do (for Security review) and runs the real PgStore against a branch.
//   API_DATABASE_URL=<api_rw url> npx tsx --env-file=.env scripts/db-check-api-role.ts
// Dev branch only: it creates and deletes a test account (provider 'test'). DATABASE_URL (app_rw)
// is used to show that the price role can't see the account schema.

import { neon } from '@neondatabase/serverless'
import { sha256 } from '../apps/api/src/auth/crypto.js'
import { MAX_SESSIONS, PgStore } from '../apps/api/src/auth/store.js'
import { connectDatabase } from '../apps/api/src/db/client.js'

const apiUrl = process.env.API_DATABASE_URL
if (!apiUrl) throw new Error('API_DATABASE_URL (api_rw) is not set')
const api = neon(apiUrl)

const [who] = await api`select current_user as u, r.rolsuper as su, r.rolcreatedb as createdb, r.rolcreaterole as createrole,
  r.rolinherit as inherit, r.rolbypassrls as bypassrls, r.rolreplication as replication, r.rolconnlimit as connlimit,
  pg_has_role(current_user,'neon_superuser','member') as neon_su, current_setting('statement_timeout') as timeout
  from pg_roles r where r.rolname = current_user`
console.log(who)
if (!(await api`select 1 from information_schema.tables where table_name = 'dev_marker'`).length) {
  throw new Error('not the dev branch (no dev_marker visible): refusing to write test rows')
}

const grants = await api`select table_schema || '.' || table_name as t, string_agg(privilege_type, ',' order by privilege_type) p
  from information_schema.role_table_grants where grantee = 'api_rw' group by 1 order by 1`
for (const g of grants) console.log(String(g.t).padEnd(24), g.p)
const columns = await api`select table_name || '.' || column_name as c, privilege_type p
  from information_schema.column_privileges where grantee = 'api_rw' and privilege_type = 'UPDATE' order by 1`
console.log('column UPDATE:', columns.map((c) => c.c).join(', '))

const mustFail: [string, string][] = [
  ['read price_snapshot', 'select * from public.price_snapshot limit 1'],
  ['read fx_rate', 'select * from public.fx_rate limit 1'],
  ['create table in account', 'create table account.x(a int)'],
  ['create table in public', 'create table public.x(a int)'],
  ['create schema', 'create schema evil'],
  ['temp table', 'create temp table t(a int)'],
  ['truncate sessions', 'truncate account.sessions'],
  ['update users.created_at', "update account.users set created_at = now() where false"],
  ['update oauth_accounts', "update account.oauth_accounts set subject = 'x' where false"],
  ['delete oauth_accounts', 'delete from account.oauth_accounts where false'],
  ['update sessions.user_id', "update account.sessions set user_id = gen_random_uuid() where false"],
  ['bad provider', "insert into account.oauth_accounts(provider, subject, user_id) values ('evil', 'x', gen_random_uuid())"],
  ['long nickname', "insert into account.users(nickname) values (repeat('가', 21))"],
  ['backdated session', "insert into account.sessions(token_hash, user_id, expires_at, created_at) values (decode(repeat('00', 32), 'hex'), gen_random_uuid(), now(), now() + interval '1 year')"],
  ['user with chosen id', "insert into account.users(id, nickname) values (gen_random_uuid(), 'ab')"],
  ['short token hash', "insert into account.sessions(token_hash, user_id, expires_at) values ('\\x00', gen_random_uuid(), now())"],
]
for (const [label, q] of mustFail) {
  try {
    await api.query(q)
    console.log(label.padEnd(26), 'ALLOWED (bad)')
  } catch (e) {
    console.log(label.padEnd(26), 'blocked:', String((e as Error).message).slice(0, 70))
  }
}

if (process.env.DATABASE_URL) {
  const app = neon(process.env.DATABASE_URL)
  try {
    await app`select count(*) from account.users`
    console.log('app_rw reads account.users   ALLOWED (bad)')
  } catch (e) {
    console.log('app_rw reads account.users   blocked:', String((e as Error).message).slice(0, 70))
  }
}

// The real store, end to end
const { db, close } = connectDatabase(apiUrl)
const store = new PgStore(db)
const subject = `check-${Date.now()}`
try {
  console.log('isDevDatabase:', await store.isDevDatabase())
  const a = await store.signIn('test', subject, '트레이너0001')
  const [b, c] = await Promise.all([store.signIn('test', subject, '트레이너0002'), store.signIn('test', subject, '트레이너0003')])
  console.log('same account on repeat/concurrent sign-in:', a === b && b === c)
  const day = 86_400_000
  for (let i = 0; i < MAX_SESSIONS + 3; i += 1) await store.createSession(a, sha256(`${subject}-${i}`), new Date(Date.now() + day))
  const [{ n }] = await api`select count(*)::int as n from account.sessions where user_id = ${a}`
  console.log(`sessions kept: ${n} (max ${MAX_SESSIONS})`)
  const last = sha256(`${subject}-${MAX_SESSIONS + 2}`)
  const found = await store.findSession(last, new Date())
  console.log('find newest session:', found?.userId === a, 'oldest gone:', (await store.findSession(sha256(`${subject}-0`), new Date())) === null)
  await store.extendSession(last, new Date(Date.now() + 2 * day), new Date())
  try {
    await store.extendSession(last, new Date(Date.now() + 100 * day), new Date())
    console.log('extend past 90 days        ALLOWED (bad)')
  } catch {
    console.log('extend past 90 days        blocked by sessions_expiry_check')
  }
  await store.deleteSession(last)
  console.log('deleted session gone:', (await store.findSession(last, new Date())) === null)
  console.log('providers:', await store.providersOf(a))
} finally {
  // Removing the user removes its sign-in method and sessions (cascade)
  await api`delete from account.users where id in (select user_id from account.oauth_accounts where provider = 'test' and subject = ${subject})`
  const [{ left }] = await api`select count(*)::int as left from account.oauth_accounts where subject = ${subject}`
  console.log('cleanup, rows left:', left)
  await close()
}
