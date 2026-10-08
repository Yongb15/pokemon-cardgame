// Migrations run only locally, as the database owner (never from the build or at runtime).
//   npm run db:generate   SQL from server/db/schema.ts + apps/api/src/db/schema.ts → db/migrations
//   npm run db:migrate    apply to the branch in DATABASE_URL_OWNER (.env: the dev branch)
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER is not set (see .env.example)')

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./server/db/schema.ts', './apps/api/src/db/schema.ts'],
  out: './db/migrations',
  dbCredentials: { url },
  strict: true,
  verbose: false,
})
