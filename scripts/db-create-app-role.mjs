// Creates (or resets the password of) the app's least-privilege role `app_rw` with SQL, connected
// as the owner. Roles made in the Neon console/CLI join neon_superuser (read/write on everything),
// so this role is made with plain SQL instead. Table privileges come from the migrations.
//
//   node scripts/db-create-app-role.mjs <out-file>
//
// The owner connection string comes from DATABASE_URL_OWNER. The app's connection string is
// written to <out-file> (one line, mode 600) and never printed: move it into .env / Vercel env
// without echoing it, then delete the file.

import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const out = process.argv[2]
const ownerUrl = process.env.DATABASE_URL_OWNER
if (!out || !ownerUrl) throw new Error('Usage: DATABASE_URL_OWNER=… node scripts/db-create-app-role.mjs <out-file>')

const sql = neon(ownerUrl)
// Hex only, so it can sit in the statement (DDL takes no bind parameters)
const password = randomBytes(32).toString('hex')

const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = 'app_rw') as exists`
await sql.query(
  `${exists ? 'alter' : 'create'} role app_rw with login password '${password}' ` +
    'nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 20',
)
await sql.query(`alter role app_rw set statement_timeout = '5s'`)
const [{ db }] = await sql`select current_database() as db`
await sql.query(`grant connect on database "${db}" to app_rw`)

const url = new URL(ownerUrl)
url.username = 'app_rw'
url.password = password
await writeFile(out, url.toString(), { mode: 0o600 })
console.log(`app_rw ${exists ? 'password reset' : 'created'}; connection string written to ${out}`)
