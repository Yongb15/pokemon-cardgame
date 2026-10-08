import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

/**
 * A small pool to Neon's pooler (max 5 per instance × 2 instances). Errors are logged by name
 * only: they can carry the connection string
 */
export function connectDatabase(url: string): { db: NodePgDatabase; close: () => Promise<void> } {
  // Neon's URLs say sslmode=require; pg treats that as verify-full today and plans to weaken it,
  // so ask for full certificate checks by name
  const strict = new URL(url)
  strict.searchParams.set('sslmode', 'verify-full')
  const pool = new pg.Pool({
    connectionString: strict.toString(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (error) => console.error('database pool error:', error.name))
  return { db: drizzle(pool), close: () => pool.end() }
}
