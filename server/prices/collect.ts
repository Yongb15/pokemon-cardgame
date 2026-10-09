// The daily all-card price collector (docs/price/collect-all.md), run by GitHub Actions through
// scripts/collect-prices.ts. Same fetching and storing as the cron and refresh-on-view, plus:
// - tiers: Standard cards and sets from the last year daily, the rest once a week (spread by id)
// - politeness: 2 at a time, a pause after each card, Retry-After honored, stop on repeated 429s
// - limits: a deadline, and a stop after many failures in a row

import { addDays, utcDay } from './logic.js'
import type { CardInfo } from './refresh.js'

export const COLLECT_CONCURRENCY = 2
export const PAUSE_MS = 400
export const DEADLINE_MS = 100 * 60 * 1000
/** A card refreshed this long ago is due again (the job starts at about the same time each day) */
export const DUE_HOURS = 20
const MAX_RATE_LIMITED_IN_A_ROW = 3
const MAX_FAILED_IN_A_ROW = 50

/** A small stable hash of the card id, for spreading weekly cards over the days */
export function idHash(id: string) {
  let h = 0
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Daily: Standard-legal, or from a set released within a year. Weekly: on the day the id hash picks */
export function isDueToday(card: CardInfo, setReleased: Map<string, string>, today: string) {
  if (card.legal?.includes('s')) return true
  const released = setReleased.get(card.set) // "YYYY/MM/DD"
  if (released && released.replaceAll('/', '-') >= addDays(today, -365)) return true
  const dayNumber = Math.floor(Date.parse(today) / 86_400_000)
  return idHash(card.id) % 7 === dayNumber % 7
}

/** Oldest first, never-refreshed before everything; only those older than DUE_HOURS */
export function dueOrder(ids: string[], times: Map<string, Date>, now: Date) {
  const cutoff = now.getTime() - DUE_HOURS * 3_600_000
  return ids
    .filter((id) => (times.get(id)?.getTime() ?? 0) <= cutoff)
    .sort((a, b) => (times.get(a)?.getTime() ?? 0) - (times.get(b)?.getTime() ?? 0) || a.localeCompare(b))
}

export interface CollectCounts {
  processed: number
  changed: number
  notFound: number
  failed: number
  rateLimited: number
  skipped: number
  left: number
  stopped: null | 'rate-limited' | 'failures' | 'deadline'
}

export type Handle = (id: string) => Promise<{ status: string; changed: number; retryAfter?: number | null } | 'skipped'>

/**
 * Works through `queue` politely. `sleep` and `now` are injectable for tests. A rate limit waits
 * (Retry-After, else 5 s, 10 s, 20 s…) and puts the card back; three in a row end the run.
 */
export async function collect(
  queue: string[],
  handle: Handle,
  {
    concurrency = COLLECT_CONCURRENCY,
    pauseMs = PAUSE_MS,
    deadline = Date.now() + DEADLINE_MS,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = Date.now,
  } = {},
): Promise<CollectCounts> {
  const counts: CollectCounts = { processed: 0, changed: 0, notFound: 0, failed: 0, rateLimited: 0, skipped: 0, left: 0, stopped: null }
  let limitedInARow = 0
  let failedInARow = 0
  const stop = (why: CollectCounts['stopped']) => {
    counts.stopped ??= why
  }

  const worker = async () => {
    while (queue.length && !counts.stopped) {
      if (now() >= deadline) return stop('deadline')
      const id = queue.shift()!
      let result: Awaited<ReturnType<Handle>>
      try {
        result = await handle(id)
      } catch {
        result = { status: 'error', changed: 0 }
      }
      if (result === 'skipped') {
        counts.skipped++
        continue
      }
      if (result.status === 'rate_limited') {
        counts.rateLimited++
        limitedInARow++
        queue.unshift(id) // tried again after the wait (or tomorrow, if we stop)
        if (limitedInARow >= MAX_RATE_LIMITED_IN_A_ROW) return stop('rate-limited')
        await sleep(result.retryAfter ? result.retryAfter * 1000 : 5000 * 2 ** (limitedInARow - 1))
        continue
      }
      limitedInARow = 0
      counts.processed++
      counts.changed += result.changed
      if (result.status === 'not_found') counts.notFound++
      if (result.status === 'error') {
        counts.failed++
        failedInARow++
        if (failedInARow >= MAX_FAILED_IN_A_ROW) return stop('failures')
      } else failedInARow = 0
      await sleep(pauseMs)
    }
  }
  await Promise.allSettled(Array.from({ length: concurrency }, worker))
  counts.left = queue.length
  return counts
}

export const todayUtc = (now: Date) => utcDay(now)
