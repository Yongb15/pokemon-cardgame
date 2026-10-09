import { describe, expect, it } from 'vitest'
import { addDays, type FxRow } from './logic.js'
import { editionView, type Rates, type StoredRow } from './view.js'

const today = '2026-10-08' // a Thursday
const d = (offset: number) => addDays(today, offset)
const row = (from: number, to: number, market: number, extra: Partial<StoredRow> = {}): StoredRow => ({
  source: 'tcgplayer',
  variant: 'normal',
  currency: 'USD',
  capturedOn: d(from),
  lastSeenOn: d(to),
  market,
  flagged: false,
  ...extra,
})

// Weekday-only USD rates of 1000 (so ₩ = $ × 1000), EUR 1500
function weekdayRates(): Rates {
  const usd: FxRow[] = []
  const eur: FxRow[] = []
  for (let i = -120; i <= 0; i++) {
    const day = new Date(`${d(i)}T00:00:00Z`).getUTCDay()
    if (day === 0 || day === 6) continue
    usd.push({ rateDate: d(i), krwPerUnit: 1000, usable: true })
    eur.push({ rateDate: d(i), krwPerUnit: 1500, usable: true })
  }
  return new Map([
    ['USD', usd],
    ['EUR', eur],
  ])
}
const rates = weekdayRates()

describe('edition view', () => {
  it('has no headline without prices', () => {
    expect(editionView([], rates, 30, today).latest).toBeNull()
  })

  it('picks TCGplayer normal as the headline and lists the rest as others (qa D-6)', () => {
    const view = editionView(
      [row(-5, 0, 0.12), row(-5, 0, 0.35, { variant: 'reverse' }), row(-5, 0, 0.1, { source: 'cardmarket', currency: 'EUR' })],
      rates,
      30,
      today,
    )
    expect(view.latest).toMatchObject({ source: 'tcgplayer', variant: 'normal', krw: 120 })
    expect(view.others.map((p) => `${p.source}:${p.variant}`).sort()).toEqual(['cardmarket:normal', 'tcgplayer:reverse'])
    expect(view.others.find((p) => p.source === 'cardmarket')?.krw).toBe(150)
  })

  it('uses Cardmarket when there is no TCGplayer price', () => {
    const view = editionView([row(-5, 0, 0.4, { source: 'cardmarket', currency: 'EUR' })], rates, 30, today)
    expect(view.latest).toMatchObject({ source: 'cardmarket', krw: 600 })
  })

  it('marks prices under ₩10 apart from no price (qa N-1)', () => {
    const view = editionView([row(-1, 0, 0.005)], rates, 30, today)
    expect(view.latest).toMatchObject({ krw: null, belowMin: true })
  })

  it('converts a weekend day with Friday’s rate (qa D-1)', () => {
    // 2026-10-03 is a Saturday
    const view = editionView([row(-5, -5, 0.2)], rates, 30, today)
    expect(view.latest).toMatchObject({ date: '2026-10-03', fxDate: '2026-10-02', krw: 200 })
  })

  it('leaves flagged outliers out, as excluded days, not gaps (qa P3-1)', () => {
    const view = editionView([row(-30, -11, 0.2), row(-10, -10, 2.5, { flagged: true }), row(-9, 0, 0.21)], rates, 30, today)
    expect(view.summary?.max).toBe(210)
    expect(view.history.points.some((p) => p.krw === 2500)).toBe(false)
    expect(view.history.gaps).toEqual([])
    expect(view.history.excluded).toEqual([{ from: d(-10), to: d(-10) }])
  })
  it('keeps one point per day, the newer level winning (qa P3-2)', () => {
    const view = editionView([row(-5, 0, 0.16), row(0, 0, 0.19)], rates, 30, today)
    expect(view.history.points.filter((p) => p.date === today)).toEqual([{ date: today, krw: 190 }])
  })

  it('draws a level that started before the range from the range start (qa D-4)', () => {
    const view = editionView([row(-45, 0, 0.25)], rates, 30, today)
    expect(view.history.points[0]).toEqual({ date: d(-29), krw: 250 })
    expect(view.history.points).toHaveLength(30)
    expect(view.history.before).toBeNull()
  })

  it('reports a gap of failed days between two levels (qa D-4)', () => {
    const view = editionView([row(-30, -12, 0.5), row(-5, 0, 0.55)], rates, 30, today)
    expect(view.history.gaps).toEqual([{ from: d(-11), to: d(-6) }])
  })

  it('starts from the earlier price when the range opens with unchecked days (qa D-4)', () => {
    const view = editionView([row(-60, -35, 0.2), row(-10, 0, 0.3)], rates, 30, today)
    expect(view.history.before).toEqual({ date: d(-35), krw: 200 })
    expect(view.history.gaps).toEqual([{ from: d(-29), to: d(-11) }])
  })
  it('gives the last earlier price when nothing in the range is known (qa D-4)', () => {
    const view = editionView([row(-60, -40, 0.18)], rates, 30, today)
    expect(view.history.points).toEqual([])
    expect(view.history.before).toEqual({ date: d(-40), krw: 180 })
  })

  it('counts staleness from last_seen_on (qa S-1)', () => {
    expect(editionView([row(-40, -10, 0.18)], rates, 30, today).staleDays).toBe(10)
    expect(editionView([row(-40, -1, 0.18)], rates, 30, today).staleDays).toBeNull()
  })

  it('summarizes min, max and change over the range', () => {
    const view = editionView([row(-29, -15, 1), row(-14, 0, 1.5)], rates, 30, today)
    expect(view.summary).toEqual({ min: 1000, max: 1500, changePct: 50 })
  })

  it('has no change with a single point', () => {
    expect(editionView([row(0, 0, 0.15)], rates, 30, today).summary?.changePct).toBeNull()
  })

  it("shows Cardmarket's 30-day average for the headline's print", () => {
    const cm = { source: 'cardmarket', currency: 'EUR' }
    const view = editionView(
      [row(0, 0, 1), row(-3, 0, 2, { ...cm, variant: 'holo', avg30: 4 }), row(-3, 0, 1.2, { ...cm, avg30: 1.4 })],
      rates,
      30,
      today,
    )
    expect(view.avg30).toMatchObject({ krw: 2100, amount: 1.4, currency: 'EUR', source: 'cardmarket', variant: 'normal' })
  })

  it("falls back to Cardmarket's own print, and has none without an average", () => {
    const cm = { source: 'cardmarket', currency: 'EUR', variant: 'holo' }
    expect(editionView([row(0, 0, 1), row(0, 0, 2, { ...cm, avg30: 2 })], rates, 30, today).avg30?.variant).toBe('holo')
    expect(editionView([row(0, 0, 1), row(0, 0, 2, { ...cm, avg30: null })], rates, 30, today).avg30).toBeNull()
    expect(editionView([row(0, 0, 1)], rates, 30, today).avg30).toBeNull()
    // Stored as 0 after rounding: no price (qa A-1)
    expect(editionView([row(0, 0, 1), row(0, 0, 2, { ...cm, avg30: 0 })], rates, 30, today).avg30).toBeNull()
  })
})
