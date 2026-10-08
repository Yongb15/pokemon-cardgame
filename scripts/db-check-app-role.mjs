// Shows what the app role can do (for Security review): run with the app connection string.
//   node --env-file=.env scripts/db-check-app-role.mjs
// Prints the role flags and grants, then tries four things app_rw must not be able to do.

import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)
const who = await sql`select current_user as u, (select rolsuper from pg_roles where rolname=current_user) as su,
  pg_has_role(current_user,'neon_superuser','member') as neon_su, current_setting('statement_timeout') as timeout`
console.log(who[0])
const grants = await sql`select table_name, string_agg(privilege_type, ',' order by privilege_type) p
  from information_schema.role_table_grants where grantee='app_rw' group by table_name order by 1`
for (const g of grants) console.log(g.table_name.padEnd(18), g.p)
for (const [label, q] of [
  ['create table', 'create table x(a int)'],
  ['insert card_edition_link', "insert into card_edition_link values ('a','ja','b','auto',1,false)"],
  ['truncate price_snapshot', 'truncate price_snapshot'],
  ['bad variant', "insert into price_snapshot(card_id,edition,source,variant,captured_on,last_seen_on,currency,market) values ('a','en','tcgplayer','evil','2026-01-01','2026-01-01','USD',1)"],
]) { try { await sql.query(q); console.log(label, 'ALLOWED (bad)') } catch (e) { console.log(label, 'blocked:', String(e.message).slice(0, 60)) } }
