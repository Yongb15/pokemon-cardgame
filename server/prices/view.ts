// Turns stored price levels into what the detail page shows for one edition (pure, testable).
// Rules: docs/price/design.md (qa D-1 weekend rates, D-4 range start and gaps, D-6 headline
// variant, N-1 below ₩10, S-1/P2-3 age from last_seen_on).

import { addDays, daysBetween, headlineVariant, rateOn, toKrw, type FxRow, type Variant } from './logic.js'

export interface StoredRow {
  source: string
  variant: string
  currency: string
  capturedOn: string
  lastSeenOn: string
  market: number
  flagged: boolean
}

export interface Price {
  krw: number | null
  /** Under ₩10: show "₩10 미만", which is not the same as no price (qa N-1) */
  belowMin: boolean
  amount: number
  currency: string
  source: string
  variant: string
  /** The day this price was last confirmed (UTC) */
  date: string
  /** The rate's day: the latest on or before `date` (none on weekends: qa D-1) */
  fxDate: string | null
}

export interface Point {
  date: string
  krw: number | null
}

export interface EditionView {
  latest: Price | null
  others: Price[]
  history: {
    points: Point[]
    /** Days nobody confirmed a price: refreshes failed (qa D-4). Outlier days are not gaps. */
    gaps: { from: string; to: string }[]
    /** Days whose price was an outlier and is left out of the line (qa D-5, P3-1) */
    excluded: { from: string; to: string }[]
    /**
     * The last price before the range, when the range doesn't start with a known price (the card
     * went unchecked into the range, or nothing in it is known yet): the line's starting point (qa D-4)
     */
    before: Point | null
  }
  summary: { min: number; max: number; changePct: number | null } | null
  /** Days since the price was last confirmed, when that's more than a day ago (qa S-1) */
  staleDays: number | null
}

export type Rates = Map<string, FxRow[]>

/** Which source's price leads: TCGplayer for English cards; Japanese ones only have Cardmarket */
const SOURCE_ORDER = ['tcgplayer', 'cardmarket']

function price(row: StoredRow, rates: Rates, day = row.lastSeenOn): Price {
  const fx = rateOn(rates.get(row.currency) ?? [], day)
  const krw = fx ? toKrw(row.market, fx.krwPerUnit) : null
  return {
    krw: krw?.krw ?? null,
    belowMin: krw?.belowMin ?? false,
    amount: row.market,
    currency: row.currency,
    source: row.source,
    variant: row.variant,
    date: row.lastSeenOn,
    fxDate: fx?.rateDate ?? null,
  }
}

export function editionView(rows: StoredRow[], rates: Rates, rangeDays: number, today: string): EditionView {
  const usable = rows.filter((r) => !r.flagged).sort((a, b) => a.capturedOn.localeCompare(b.capturedOn))
  const groups = new Map<string, StoredRow[]>()
  for (const r of usable) groups.set(`${r.source}:${r.variant}`, [...(groups.get(`${r.source}:${r.variant}`) ?? []), r])

  // The headline: the first source that has prices, then normal → holo → reverse → …
  let headKey: string | null = null
  for (const source of SOURCE_ORDER) {
    const variants = [...groups.keys()].filter((k) => k.startsWith(`${source}:`)).map((k) => k.split(':')[1] as Variant)
    const variant = headlineVariant(variants)
    if (variant) {
      headKey = `${source}:${variant}`
      break
    }
  }
  if (!headKey) {
    return { latest: null, others: [], history: { points: [], gaps: [], excluded: [], before: null }, summary: null, staleDays: null }
  }

  const head = groups.get(headKey)!
  const last = head.at(-1)!
  const latest = price(last, rates)
  const others = [...groups.entries()].filter(([k]) => k !== headKey).map(([, g]) => price(g.at(-1)!, rates))

  // Daily points over the range from the headline's levels, each day at that day's rate. A later
  // level wins a day both cover (the old level seen and a new one captured the same day: qa P3-2).
  const start = addDays(today, -(rangeDays - 1))
  const clip = (r: StoredRow) => ({ from: r.capturedOn > start ? r.capturedOn : start, to: r.lastSeenOn < today ? r.lastSeenOn : today })
  const byDay = new Map<string, number | null>()
  for (const level of head) {
    if (level.lastSeenOn < start) continue
    const { from, to } = clip(level)
    for (let day = from; day <= to; day = addDays(day, 1)) byDay.set(day, price(level, rates, day).krw)
  }
  const points: Point[] = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, krw]) => ({ date, krw }))

  // Days some row of this price confirmed, outliers included: an outlier day was checked, so it's
  // left out of the line but isn't a failed refresh (qa P3-1)
  const [source, variant] = headKey.split(':')
  const sameKind = rows.filter((r) => r.source === source && r.variant === variant && r.lastSeenOn >= start)
  const seen = new Set<string>()
  const excluded: { from: string; to: string }[] = []
  for (const r of sameKind) {
    const { from, to } = clip(r)
    for (let day = from; day <= to; day = addDays(day, 1)) seen.add(day)
    if (r.flagged) excluded.push({ from, to })
  }

  const earlier = head.filter((r) => r.lastSeenOn < start).at(-1)
  const before = earlier && (!points.length || points[0].date > start) ? { date: earlier.lastSeenOn, krw: price(earlier, rates).krw } : null
  // Unchecked days from the first point (or the range start, when something came before) to the last
  const gaps: { from: string; to: string }[] = []
  if (points.length) {
    let open: string | null = null
    for (let day = earlier ? start : points[0].date; day <= points.at(-1)!.date; day = addDays(day, 1)) {
      if (!seen.has(day)) open ??= day
      else if (open) {
        gaps.push({ from: open, to: addDays(day, -1) })
        open = null
      }
    }
  }

  const values = points.map((p) => p.krw).filter((v): v is number => v !== null)
  const summary = values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        changePct: values.length > 1 && values[0] > 0 ? Math.round(((values.at(-1)! - values[0]) / values[0]) * 1000) / 10 : null,
      }
    : null

  const age = daysBetween(last.lastSeenOn, today)
  return { latest, others, history: { points, gaps, excluded, before }, summary, staleDays: age > 1 ? age : null }
}
