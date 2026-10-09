// Creates (or resets the password of) a least-privilege role with SQL, connected as the owner:
// `app_rw` for the price functions, `api_rw` for the API server (each sees only its own tables).
// Roles made in the Neon console/CLI join neon_superuser (read/write on everything), so these are
// made with plain SQL instead. Table privileges come from the migrations.
//
//   node scripts/db-create-role.mjs <app_rw|api_rw> <out-file>
//
// The owner connection string comes from DATABASE_URL_OWNER. The role's connection string is
// written to <out-file> (one line; keep it in the OS temp folder: mode 600 does nothing on Windows)
// and never printed: move it into .env / Vercel env / Secret Manager without echoing it, then
// delete the file.

import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const ROLES = ['app_rw', 'api_rw', 'collector_rw']
const role = process.argv[2]
const out = process.argv[3]
const ownerUrl = process.env.DATABASE_URL_OWNER
if (!ROLES.includes(role) || !out || !ownerUrl) {
  throw new Error('Usage: DATABASE_URL_OWNER=… node scripts/db-create-role.mjs <app_rw|api_rw> <out-file>')
}

const sql = neon(ownerUrl)
const password = randomBytes(32).toString('hex')

// Hex only, so it can sit in the statement (DDL takes no bind parameters). A pre-hashed SCRAM
// verifier would keep the plaintext out of statement logs, but Neon rejects it ("Neon only supports
// being given plaintext passwords", 2026-10-08), and only owner-level roles can read those logs.
// The role name comes from the fixed list above, never from free input.
const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = ${role}) as exists`
if (exists) {
  // Only the password: the other attributes were set when the role was created (changing
  // SUPERUSER/REPLICATION/BYPASSRLS needs a superuser, even to set them to "no")
  await sql.query(`alter role ${role} with password '${password}'`)
} else {
  await sql.query(
    `create role ${role} with login password '${password}' ` +
      `nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit ${role === 'collector_rw' ? 5 : 20}`,
  )
}
await sql.query(`alter role ${role} set statement_timeout = '5s'`)
const [{ db }] = await sql`select current_database() as db`
await sql.query(`grant connect on database "${db}" to ${role}`)

const url = new URL(ownerUrl)
url.username = role
url.password = password
await writeFile(out, url.toString(), { mode: 0o600 })
console.log(`${role} ${exists ? 'password reset' : 'created'}; connection string written to ${out}`)
