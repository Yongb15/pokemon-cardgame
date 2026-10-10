// The PSA block of a card's prices answer (docs/price/psa.md, docs/design/psa-prices.webp): only
// what the screen shows (Security P-1) — per grade the median, sale count and last sale date of the
// latest collection, plus each grade's medians over time for the chart.

import { addDays, rateOn, toKrw, type FxRow } from './logic.js'
import { PSA_MIN_USD } from './psaCollect.js'
import type { PsaRow } from './store.js'

/** Older than this the values aren't shown: the collection has stopped (Security, ToS freshness) */
export const PSA_MAX_AGE_DAYS = 30
const GRADE_ORDER = ['psa10', 'psa9', 'psa8']

export interface PsaGradeView {
  grade: string
  usd: number
  krw: number | null
  sales: number
  lastSaleOn: string | null
}

export type PsaView =
  /** Not among the cards we collect for (TCGplayer price under $50) */
  | { state: 'untracked'; minUsd: number }
  /** Priced high enough, but nothing to show: not collected yet, no grade with enough sales, or too old */
  | { state: 'pending' }
  | { state: 'ok'; capturedOn: string; grades: PsaGradeView[]; history: { grade: string; points: { date: string; usd: number }[] }[] }

/**
 * `rawUsd`: the card's highest stored TCGplayer price (any print), deciding whether it's a card we
 * collect PSA prices for. (The site's role reads only psa_price, not when each card was tried.)
 */
export function psaView(rows: PsaRow[], rawUsd: number | null, usd: FxRow[], today: string): PsaView {
  const fresh = (day: string) => day >= addDays(today, -PSA_MAX_AGE_DAYS)
  const latest = rows.reduce<string | null>((max, r) => (max === null || r.capturedOn > max ? r.capturedOn : max), null)
  if (latest && fresh(latest)) {
    const fx = rateOn(usd, today)
    const grades = rows
      .filter((r) => r.capturedOn === latest)
      .sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade))
      .map((r) => ({
        grade: r.grade,
        usd: r.median,
        krw: fx ? toKrw(r.median, fx.krwPerUnit).krw : null,
        sales: r.sales,
        lastSaleOn: r.lastSaleOn,
      }))
    const history = GRADE_ORDER.map((grade) => ({
      grade,
      points: rows.filter((r) => r.grade === grade).map((r) => ({ date: r.capturedOn, usd: r.median })),
    })).filter((h) => h.points.length)
    return { state: 'ok', capturedOn: latest, grades, history }
  }
  return rawUsd !== null && rawUsd >= PSA_MIN_USD ? { state: 'pending' } : { state: 'untracked', minUsd: PSA_MIN_USD }
}
