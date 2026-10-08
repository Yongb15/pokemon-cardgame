// Creates (or resets the password of) the app's least-privilege role `app_rw` with SQL, connected
// as the owner. Roles made in the Neon console/CLI join neon_superuser (read/write on everything),
// so this role is made with plain SQL instead. Table privileges come from the migrations.
//
//   node scripts/db-create-app-role.mjs <out-file>
//
// The owner connection string comes from DATABASE_URL_OWNER. The app's connection string is
// written to <out-file> (one line; keep it in the OS temp folder: mode 600 does nothing on Windows)
// and never printed: move it into .env / Vercel env without echoing it, then delete the file.

import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const out = process.argv[2]
const ownerUrl = process.env.DATABASE_URL_OWNER
if (!out || !ownerUrl) throw new Error('Usage: DATABASE_URL_OWNER=… node scripts/db-create-app-role.mjs <out-file>')

const sql = neon(ownerUrl)
const password = randomBytes(32).toString('hex')

// Hex only, so it can sit in the statement (DDL takes no bind parameters). A pre-hashed SCRAM
// verifier would keep the plaintext out of statement logs, but Neon rejects it ("Neon only supports
// being given plaintext passwords", 2026-10-08), and only owner-level roles can read those logs.
const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = 'app_rw') as exists`
if (exists) {
  // Only the password: the other attributes were set when the role was created (changing
  // SUPERUSER/REPLICATION/BYPASSRLS needs a superuser, even to set them to "no")
  await sql.query(`alter role app_rw with password '${password}'`)
} else {
  await sql.query(
    `create role app_rw with login password '${password}' ` +
      'nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 20',
  )
}
await sql.query(`alter role app_rw set statement_timeout = '5s'`)
const [{ db }] = await sql`select current_database() as db`
await sql.query(`grant connect on database "${db}" to app_rw`)

const url = new URL(ownerUrl)
url.username = 'app_rw'
url.password = password
await writeFile(out, url.toString(), { mode: 0o600 })
console.log(`app_rw ${exists ? 'password reset' : 'created'}; connection string written to ${out}`)
