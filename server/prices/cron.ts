// The daily price run (Vercel Cron → GET /api/cron/prices with "Authorization: Bearer $CRON_SECRET").
//
// Picks up to CRON_BUDGET cards whose last refresh is 24 hours old: at least 70% Standard-legal
// cards, at most 30% from recent views (so fake views can't steer the whole run: Security), oldest
// refresh first. Stops before the function's time limit; what's left is simply first in line the
// next day. Also stores the day's exchange rates.

import { timingSafeEqual } from 'node:crypto'
import { addDays, utcDay } from './logic.js'
import { isBasicEnergy, loadPriceData, refreshCard } from './refresh.js'
import { fetchFx } from './sources.js'
import { claimRefresh, refreshTimes, saveFx, topViewed } from './store.js'

export const CRON_BUDGET = 2000
// A smaller run for manual tests on dev (ignored in production)
const budget = () => {
  const limit = Number(process.env.PRICE_CRON_LIMIT)
  return process.env.VERCEL_ENV !== 'production' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, CRON_BUDGET) : CRON_BUDGET
}
const VIEWED_SHARE = 0.3
const CONCURRENCY = 4
/** Leave room under the function's 300 s limit */
const TIME_BUDGET_MS = 240_000

const noStore = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: noStore })

/** Fails closed: no secret, or a short one, means nobody is authorized (Security) */
export function isAuthorized(header: string | null, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 32 || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export interface RunCounts {
  processed: number
  changed: number
  notFound: number
  failed: number
  skipped: number
}

/**
 * Works through `queue` with a few workers until it's empty or `deadline` (ms timestamp) passes.
 * One card failing (a DB hiccup, a bad reply) is counted and the run goes on (qa P2-1, Security P-2).
 */
export async function runQueue(
  queue: string[],
  handle: (id: string) => Promise<{ status: string; changed: number } | 'skipped'>,
  { concurrency = CONCURRENCY, deadline = Infinity } = {},
) {
  const counts: RunCounts = { processed: 0, changed: 0, notFound: 0, failed: 0, skipped: 0 }
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const id = queue.shift()!
      try {
        const result = await handle(id)
        if (result === 'skipped') {
          counts.skipped++
          continue
        }
        counts.processed++
        counts.changed += result.changed
        if (result.status === 'not_found') counts.notFound++
        if (result.status === 'error' || result.status === 'rate_limited') counts.failed++
      } catch {
        counts.failed++
      }
    }
  }
  await Promise.allSettled(Array.from({ length: concurrency }, worker))
  return { ...counts, left: queue.length }
}

export async function handleCron(request: Request, now = new Date()) {
  if (!isAuthorized(request.headers.get('authorization'))) return reply({ error: 'unauthorized' }, 401)
  const started = Date.now()
  const today = utcDay(now)
  const counts = { candidates: 0, fx: false }

  // A failed rate update doesn't stop the card run
  try {
    const fx = await fetchFx(now)
    if (fx) {
      await saveFx(fx)
      counts.fx = true
    }
  } catch {
    counts.fx = false
  }

  try {
    const { cards, tcgdex } = await loadPriceData()
    // Only cards the source knows (unmapped ones would always come back "not found")
    const fetchable = (id: string) => tcgdex.has(id) && cards.has(id) && !isBasicEnergy(cards.get(id)!)
    const due = async (ids: string[]) => {
      const times = await refreshTimes(ids)
      const dayAgo = now.getTime() - 86_400_000
      return ids
        .filter((id) => (times.get(id)?.getTime() ?? 0) <= dayAgo)
        .sort((a, b) => (times.get(a)?.getTime() ?? 0) - (times.get(b)?.getTime() ?? 0))
    }
    const viewed = (await due(await topViewed(addDays(today, -7), Math.floor(budget() * VIEWED_SHARE)))).filter(fetchable)
    const standard = await due(
      [...cards.values()].filter((c) => c.legal?.includes('s') && fetchable(c.id) && !viewed.includes(c.id)).map((c) => c.id),
    )
    const queue = [...viewed, ...standard].slice(0, budget())
    counts.candidates = queue.length

    const run = await runQueue(
      queue,
      // Someone viewing the card may have refreshed it meanwhile
      async (id) => ((await claimRefresh(id)) ? refreshCard(id, now) : 'skipped'),
      { deadline: started + TIME_BUDGET_MS },
    )
    return reply({ ...counts, ...run, ms: Date.now() - started })
  } catch {
    // Counts only: never the error itself (it can hold query or connection details)
    return reply({ error: 'failed', ...counts }, 500)
  }
}
