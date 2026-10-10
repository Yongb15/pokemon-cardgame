// PSA response checks (Security P-3). Every value here is made up: no real API data in this public
// repository (Security P-2).
import { describe, expect, it } from 'vitest'
import { parsePsa } from './sources.js'

const grade = (median: unknown, count: unknown, lastSaleDate: unknown = '2026-01-02T00:00:00.000Z') => ({
  count,
  medianPrice: median,
  averagePrice: 1,
  lastSaleDate,
})

const response = (salesByGrade: Record<string, unknown>, externalCatalogId = 'xx01-001') => ({
  data: {
    externalCatalogId,
    name: 'Made-up Card',
    ebay: { salesByGrade, listings: [{ title: 'some listing', seller: 'someone', url: 'https://example.invalid/x' }] },
  },
})

describe('PSA prices from Pokemon Price Tracker', () => {
  it('keeps PSA 10, 9 and 8 with enough sales, rounded to cents', () => {
    const grades = parsePsa(
      response({ psa10: grade(12.345, 10), psa9: grade(5, 3), psa8: grade(2, 7, '2026-01-01'), cgc10: grade(99, 50), psa7: grade(1, 9) }),
      'xx01-001',
      '2026-01-10',
    )
    expect(grades).toEqual([
      { grade: 'psa10', median: 12.35, sales: 10, lastSaleOn: '2026-01-02' },
      { grade: 'psa9', median: 5, sales: 3, lastSaleOn: '2026-01-02' },
      { grade: 'psa8', median: 2, sales: 7, lastSaleOn: '2026-01-01' },
    ])
  })

  it('refuses a card that is not the one asked for', () => {
    expect(parsePsa(response({ psa10: grade(10, 10) }, 'yy02-002'), 'xx01-001', '2026-01-10')).toBe('mismatch')
    expect(parsePsa({ data: null }, 'xx01-001', '2026-01-10')).toBe('mismatch')
    expect(parsePsa('nonsense', 'xx01-001', '2026-01-10')).toBe('mismatch')
  })

  it('drops grades with too few sales, bad numbers or out-of-range values', () => {
    const grades = parsePsa(
      response({ psa10: grade(10, 2), psa9: grade(Number.NaN, 10), psa8: grade(2_000_000, 10) }),
      'xx01-001',
      '2026-01-10',
    )
    expect(grades).toEqual([])
    expect(parsePsa(response({ psa10: grade('10', 10), psa9: grade(10, 4.5), psa8: grade(-1, 10) }), 'xx01-001', '2026-01-10')).toEqual([])
  })

  it('takes only a past ISO date as the last sale', () => {
    const grades = parsePsa(
      response({ psa10: grade(10, 5, '2026-02-01T00:00:00Z'), psa9: grade(10, 5, 'yesterday'), psa8: grade(10, 5, '2026-02-30') }),
      'xx01-001',
      '2026-01-10',
    )
    expect(grades).toEqual([
      { grade: 'psa10', median: 10, sales: 5, lastSaleOn: null },
      { grade: 'psa9', median: 10, sales: 5, lastSaleOn: null },
      { grade: 'psa8', median: 10, sales: 5, lastSaleOn: null },
    ])
  })

  it('reads nothing but the aggregates (no listing titles, sellers or links)', () => {
    const grades = parsePsa(response({ psa10: grade(10, 5) }), 'xx01-001', '2026-01-10')
    expect(JSON.stringify(grades)).not.toMatch(/listing|someone|example/)
  })
})
