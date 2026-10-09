import { describe, expect, it } from 'vitest'
import type { FxRow } from './logic.js'
import { handleTop, rank, type Level } from './top.js'

const today = '2026-10-09'
const rates = new Map<string, FxRow[]>([
  ['USD', [{ rateDate: '2026-10-08', krwPerUnit: 1000, usable: true }]],
  ['EUR', [{ rateDate: '2026-10-08', krwPerUnit: 1500, usable: true }]],
])
const level = (cardId: string, source: string, variant: string, market: number, currency = source === 'tcgplayer' ? 'USD' : 'EUR'): Level => ({
  cardId,
  source,
  variant,
  currency,
  market,
  lastSeenOn: today,
})

describe('price ranking', () => {
  it("ranks each card by its detail-page headline: TCGplayer first, then the print order", () => {
    const ranked = rank(
      [
        level('a', 'tcgplayer', 'normal', 2),
        level('a', 'tcgplayer', 'holo', 50), // not the headline: normal comes first
        level('a', 'cardmarket', 'normal', 30),
        level('b', 'cardmarket', 'holo', 4), // only Cardmarket: €4 → ₩6,000
        level('c', 'tcgplayer', 'holo', 5),
      ],
      rates,
      today,
      () => true,
    )
    expect(ranked.map((r) => [r.id, r.krw, r.source, r.variant])).toEqual([
      ['b', 6000, 'cardmarket', 'holo'],
      ['c', 5000, 'tcgplayer', 'holo'],
      ['a', 2000, 'tcgplayer', 'normal'],
    ])
  })

  it('leaves out filtered cards, prices with no rate and ones under ₩10', () => {
    const ranked = rank(
      [level('a', 'tcgplayer', 'normal', 1), level('b', 'tcgplayer', 'normal', 0.001), level('c', 'x', 'normal', 1, 'JPY'), level('d', 'tcgplayer', 'normal', 9)],
      rates,
      today,
      (id) => id !== 'd',
    )
    expect(ranked.map((r) => r.id)).toEqual(['a'])
  })

  it('keeps the top N, ties by id', () => {
    const levels = ['c', 'a', 'b'].map((id) => level(id, 'tcgplayer', 'normal', 1))
    expect(rank(levels, rates, today, () => true, 2).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('the /api/prices/top request', () => {
  it('refuses unknown parameters and bad values before touching the database', async () => {
    for (const query of ['edition=ko', 'edition=en&x=1', 'set=../x', 'set=' + 'a'.repeat(21), 'range=30d']) {
      const res = await handleTop(new URLSearchParams(query))
      expect(res.status, query).toBe(400)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })
})
