// Shape of GET /api/cards/:id/prices (server/prices/api.ts, server/prices/view.ts)

export interface Price {
  krw: number | null
  /** Under ₩10: "₩10 미만", not the same as having no price */
  belowMin: boolean
  amount: number
  currency: string
  source: string
  variant: string
  /** UTC day the price was last confirmed */
  date: string
  /** UTC day of the exchange rate used (the latest on or before `date`) */
  fxDate: string | null
}

export interface EditionView {
  latest: Price | null
  others: Price[]
  history: {
    points: { date: string; krw: number | null }[]
    gaps: { from: string; to: string }[]
    excluded: { from: string; to: string }[]
    before: { date: string; krw: number | null } | null
  }
  summary: { min: number; max: number; changePct: number | null } | null
  staleDays: number | null
  /** Cardmarket's 30-day average for the same print: a reference while our history is short */
  avg30: Price | null
}

export type JaEdition =
  | { state: 'unlinked' | 'absent' | 'checking' | 'noPrice' }
  | ({ state: 'ok' } & EditionView)

export interface CardPrices {
  card: string
  range: '30d' | '90d'
  today: string
  editions: {
    en: { state: 'ok' | 'none' } & EditionView
    ja: JaEdition
    ko: { state: 'links'; links: { term: string; kream: string; bunjang: string } }
  }
  mixedEditions: boolean
  refresh: { refreshedAt: string | null; status: 'pending' | 'ok' | 'not_found' | 'error' | null; refreshing: boolean }
  note: string
}

export type PricesResponse = CardPrices | { card: string; hidden: true }
