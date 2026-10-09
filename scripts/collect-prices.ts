// Daily price collection for every linked card (docs/price/collect-all.md). Run by
// .github/workflows/collect-prices.yml with PRICE_DATABASE_URL (the collector_rw role).
//
//   PRICE_DATABASE_URL=… npx tsx scripts/collect-prices.ts
//
// Prints counts only: never the URL, host, user name or a database error message (Security).

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const url = process.env.PRICE_DATABASE_URL
if (!url) {
  console.error('PRICE_DATABASE_URL is not set')
  process.exit(1)
}
// The shared price code reads DATABASE_URL
process.env.DATABASE_URL = url

const { claimRefresh, refreshTimes, saveFx } = await import('../server/prices/store.js')
const { isBasicEnergy, loadPriceData, refreshCard } = await import('../server/prices/refresh.js')
const { fetchFx } = await import('../server/prices/sources.js')
const { collect, DUE_HOURS, dueOrder, isDueToday, todayUtc } = await import('../server/prices/collect.js')

const sql = neon(url)
const MB = 1024 * 1024
const WARN_BYTES = 350 * MB // 70% of Neon's free 0.5 GB: the run fails, so GitHub mails the owner
const STOP_BYTES = 450 * MB // collection doesn't start (the site's own writes continue)

/** The grants this needs, and the ones it must not have (Security: DELETE, views, budgets, account) */
async function checkGrants() {
  const [g] = (await sql`select
    has_table_privilege('price_snapshot', 'SELECT') and has_table_privilege('price_snapshot', 'INSERT')
      and has_table_privilege('price_snapshot', 'UPDATE') as snapshot_rw,
    has_table_privilege('price_refresh', 'SELECT') and has_table_privilege('price_refresh', 'INSERT')
      and has_table_privilege('price_refresh', 'UPDATE') as refresh_rw,
    has_table_privilege('fx_rate', 'SELECT') and has_table_privilege('fx_rate', 'INSERT')
      and has_table_privilege('fx_rate', 'UPDATE') as fx_rw,
    has_table_privilege('card_edition_link', 'SELECT') as link_r,
    has_table_privilege('price_snapshot', 'DELETE') or has_table_privilege('price_snapshot', 'TRUNCATE') as snapshot_delete,
    has_table_privilege('card_view_daily', 'SELECT') or has_table_privilege('card_view_daily', 'INSERT') as views,
    has_table_privilege('daily_counter', 'SELECT') or has_table_privilege('daily_counter', 'INSERT') as budgets,
    coalesce(to_regnamespace('account') is not null and has_schema_privilege('account', 'USAGE'), false) as account,
    has_database_privilege(current_database(), 'CREATE') as db_create`) as Record<string, boolean>[]
  const missing = ['snapshot_rw', 'refresh_rw', 'fx_rw', 'link_r'].filter((k) => g![k] !== true)
  const excess = ['snapshot_delete', 'views', 'budgets', 'account', 'db_create'].filter((k) => g![k] === true)
  return { missing, excess }
}

const databaseBytes = async () => Number(((await sql`select pg_database_size(current_database()) as b`) as { b: string }[])[0]!.b)

try {
  const grants = await checkGrants()
  if (grants.missing.length || grants.excess.length) {
    console.error(`grants don't match (missing: ${grants.missing.join(', ') || '-'}; too wide: ${grants.excess.join(', ') || '-'}); not collecting`)
    process.exit(1)
  }
  const before = await databaseBytes()
  if (before > STOP_BYTES) {
    console.error(`database is ${Math.round(before / MB)} MB (stop at ${STOP_BYTES / MB} MB); not collecting`)
    process.exit(1)
  }

  const now = new Date()
  const today = todayUtc(now)
  const fx = await fetchFx(now)
  if (fx) await saveFx(fx)

  const { cards, tcgdex } = await loadPriceData()
  const sets = JSON.parse(await readFile(path.join(process.cwd(), 'data/sets.json'), 'utf8')) as { id: string; releaseDate: string }[]
  const released = new Map(sets.map((s) => [s.id, s.releaseDate]))
  const todays = [...cards.values()].filter((c) => tcgdex.has(c.id) && !isBasicEnergy(c) && isDueToday(c, released, today)).map((c) => c.id)
  const queue = dueOrder(todays, await refreshTimes(todays), now)
  // A short run for trying it out (COLLECT_LIMIT=20); the scheduled run sets nothing
  const limit = Number(process.env.COLLECT_LIMIT)
  if (Number.isInteger(limit) && limit > 0) queue.splice(limit)
  console.log(`today: ${todays.length} cards in today's tiers, ${queue.length} due (older than ${DUE_HOURS} h); fx ${fx ? 'saved' : 'unavailable'}`)

  const counts = await collect(queue, async (id) => {
    if (!(await claimRefresh(id, DUE_HOURS))) return 'skipped'
    return refreshCard(id, now)
  })
  const after = await databaseBytes()
  console.log(
    `done: processed ${counts.processed}, changed ${counts.changed}, not found ${counts.notFound}, failed ${counts.failed}, ` +
      `rate limited ${counts.rateLimited}, skipped ${counts.skipped}, left ${counts.left}, stopped ${counts.stopped ?? 'no'}; ` +
      `database ${Math.round(after / MB)} MB (+${Math.round((after - before) / 1024)} KB)`,
  )
  if (after > WARN_BYTES) {
    console.error(`database is over ${WARN_BYTES / MB} MB: compact old history (docs/price/collect-all.md D-2)`)
    process.exit(2)
  }
  if (counts.stopped === 'rate-limited' || counts.stopped === 'failures') process.exit(3)
} catch (error) {
  // The name only: the message can hold a host or a query
  console.error(`collect failed: ${error instanceof Error ? error.name : 'unknown'}`)
  process.exit(1)
}
