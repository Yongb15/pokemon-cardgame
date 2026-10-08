// Pure price logic: no I/O, and "now" always comes in as an argument so the boundaries can be
// tested (qa). Rules are from docs/price/design.md (qa D-1…D-7, Security review).

import { CURRENCIES, SOURCES, VARIANTS } from '../db/schema.ts'

export type Source = (typeof SOURCES)[number]
export type Variant = (typeof VARIANTS)[number]
export type Currency = (typeof CURRENCIES)[number]

const DAY_MS = 24 * 60 * 60 * 1000

/** The UTC calendar day of a moment, "2026-10-08" (stored dates are UTC: qa D-2) */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10)

/** Days from one "YYYY-MM-DD" to another (b − a) */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)

export const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(day) + n * DAY_MS))

/** A card's prices may be fetched again once a full 24 hours have passed */
export const isRefreshDue = (refreshedAt: Date | null, now: Date) =>
  !refreshedAt || now.getTime() - refreshedAt.getTime() >= DAY_MS

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// --- Outliers (qa D-5) --------------------------------------------------------------------------

export const OUTLIER_FACTOR = 10
export const NEW_LEVEL_TOLERANCE = 0.2
export const NEW_LEVEL_DAYS = 3
const BASELINE_SIZE = 7

export interface LevelRow {
  market: number
  flagged: boolean
  /** Days this level was confirmed: last_seen_on − captured_on + 1 */
  days: number
}

export type OutlierDecision =
  | { flagged: false; acceptRun: number } // acceptRun: how many trailing flagged rows to unflag
  | { flagged: true }

const near = (value: number, level: number) => Math.abs(value - level) <= level * NEW_LEVEL_TOLERANCE

/**
 * Whether today's value is an outlier. The baseline is the median of the last 7 normal levels,
 * not just the previous value; the first value has no baseline and is accepted. A value 10× above
 * or below the baseline is flagged, unless it's the 3rd day in a row at the same new level (within
 * ±20% of where that run started): then the run becomes the new normal.
 *
 * `history` is oldest first and doesn't include today's confirmation (when today's value equals
 * the last level, today extends that row: the count is the same either way).
 */
export function decideOutlier(history: LevelRow[], value: number): OutlierDecision {
  const baseline = median(
    history
      .filter((r) => !r.flagged)
      .slice(-BASELINE_SIZE)
      .map((r) => r.market),
  )
  if (baseline === null || baseline === 0) return { flagged: false, acceptRun: 0 }
  if (value <= baseline * OUTLIER_FACTOR && value >= baseline / OUTLIER_FACTOR) return { flagged: false, acceptRun: 0 }

  // The trailing run of flagged rows at the same level as the first one in the run
  let start = history.length
  while (start > 0 && history[start - 1].flagged) start--
  const run = history.slice(start)
  const level = run[0]?.market
  // A value away from the run's level (or no run yet) starts counting again
  if (level === undefined || !near(value, level) || run.some((r) => !near(r.market, level))) return { flagged: true }
  const days = run.reduce((sum, r) => sum + r.days, 0) + 1 // + today
  return days >= NEW_LEVEL_DAYS ? { flagged: false, acceptRun: run.length } : { flagged: true }
}

// --- Exchange rates (qa D-1) ----------------------------------------------------------------------

export interface FxRow {
  rateDate: string
  krwPerUnit: number
  usable: boolean
}

/** The latest usable rate on or before `day` (there are no rates on weekends and holidays) */
export function rateOn(rates: FxRow[], day: string) {
  let best: FxRow | null = null
  for (const r of rates) {
    if (r.usable && r.rateDate <= day && (!best || r.rateDate > best.rateDate)) best = r
  }
  return best
}

/** A new rate more than 20% away from the last good one is stored but not used (Security) */
export const isUsableRate = (lastGood: number | null, rate: number) =>
  Number.isFinite(rate) && rate > 0 && (lastGood === null || Math.abs(rate - lastGood) <= lastGood * 0.2)

// --- Display --------------------------------------------------------------------------------------

const VARIANT_ORDER: Variant[] = ['normal', 'holo', 'reverse', 'firstEdition', 'unlimited']

/** The headline variant: normal → holo → reverse → others (qa D-6) */
export function headlineVariant(variants: Iterable<Variant>) {
  const have = new Set(variants)
  return VARIANT_ORDER.find((v) => have.has(v)) ?? null
}

/** Won rounded to 10 (qa B); below ₩10 there's nothing meaningful to show */
export function toKrw(amount: number, krwPerUnit: number) {
  const raw = amount * krwPerUnit
  return raw < 10 ? null : Math.round(raw / 10) * 10
}

// --- Validating outside data (Security) -----------------------------------------------------------

export const MAX_PRICE = 100_000

/** A price from TCGdex: a finite number in [0, 100000], else null */
export function cleanPrice(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? value : null
}

export const isSource = (s: string): s is Source => (SOURCES as readonly string[]).includes(s)
export const isVariant = (s: string): s is Variant => (VARIANTS as readonly string[]).includes(s)
export const isCurrency = (s: string): s is Currency => (CURRENCIES as readonly string[]).includes(s)
