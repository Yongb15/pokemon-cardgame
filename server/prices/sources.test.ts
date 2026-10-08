import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAuthorized } from './cron.js'
import { parseFx, parseTcgdexCard } from './sources.js'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8')) as unknown

describe('TCGdex prices (recorded responses)', () => {
  it('reads a holo-only card: TCGplayer holofoil + Cardmarket base as holo', () => {
    const rows = parseTcgdexCard(fixture('tcgdex-en-sv06-025'))
    expect(rows.map((r) => `${r.source}:${r.variant}:${r.currency}`)).toEqual([
      'tcgplayer:holo:USD',
      'cardmarket:holo:EUR',
    ])
    expect(rows.every((r) => r.market > 0)).toBe(true)
  })
  it('reads a common card: normal + reverse on both sources ("reverse-holofoil" key)', () => {
    const rows = parseTcgdexCard(fixture('tcgdex-en-sv06-001'))
    expect(rows.map((r) => `${r.source}:${r.variant}`).sort()).toEqual([
      'cardmarket:normal',
      'cardmarket:reverse',
      'tcgplayer:normal',
      'tcgplayer:reverse',
    ])
  })
  it('reads a Japanese card: Cardmarket only', () => {
    const rows = parseTcgdexCard(fixture('tcgdex-ja-SV2a-006'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.source === 'cardmarket' && r.currency === 'EUR')).toBe(true)
  })
})

describe('TCGdex parsing edge cases (Security, qa N-1/N-2)', () => {
  const card = (pricing: unknown, variants = { normal: true }) => ({ variants, pricing })
  it('skips unknown TCGplayer keys instead of storing them', () => {
    const rows = parseTcgdexCard(card({ tcgplayer: { unit: 'USD', evilFoil: { marketPrice: 5 }, normal: { marketPrice: 1 } } }))
    expect(rows.map((r) => r.variant)).toEqual(['normal'])
  })
  it('falls back to the mid price and ignores the high price', () => {
    const rows = parseTcgdexCard(card({ tcgplayer: { unit: 'USD', normal: { midPrice: 2, highPrice: 999 } } }))
    expect(rows[0].market).toBe(2)
  })
  it('keeps the first of two 1st Edition keys', () => {
    const rows = parseTcgdexCard(
      card({ tcgplayer: { unit: 'USD', '1stEditionHolofoil': { marketPrice: 9 }, '1stEditionNormal': { marketPrice: 4 } } }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ variant: 'firstEdition', market: 9 })
  })
  it('treats 0 as no data (Cardmarket "trend-holo": 0)', () => {
    const rows = parseTcgdexCard(card({ cardmarket: { unit: 'EUR', trend: 0.4, 'trend-holo': 0, 'avg-holo': null } }))
    expect(rows.map((r) => r.variant)).toEqual(['normal'])
  })
  it('drops out-of-range, non-numeric and wrong-currency values', () => {
    expect(parseTcgdexCard(card({ tcgplayer: { unit: 'USD', normal: { marketPrice: 1e9 } } }))).toEqual([])
    expect(parseTcgdexCard(card({ tcgplayer: { unit: 'USD', normal: { marketPrice: '3' } } }))).toEqual([])
    expect(parseTcgdexCard(card({ tcgplayer: { unit: 'JPY', normal: { marketPrice: 3 } } }))).toEqual([])
    expect(parseTcgdexCard(null)).toEqual([])
    expect(parseTcgdexCard({ pricing: [] })).toEqual([])
  })
})

describe('exchange rates', () => {
  it('crosses through EUR for precise KRW per USD and JPY', () => {
    const fx = parseFx({ base: 'EUR', date: '2026-10-07', rates: { KRW: 1496.25, USD: 1.1177, JPY: 176.85 } })
    expect(fx?.rateDate).toBe('2026-10-07')
    expect(fx?.rates.EUR).toBe(1496.25)
    expect(fx?.rates.USD).toBeCloseTo(1338.69, 1)
    expect(fx?.rates.JPY).toBeCloseTo(8.46, 2)
  })
  it('rejects other bases, bad dates and missing KRW', () => {
    expect(parseFx({ base: 'KRW', date: '2026-10-07', rates: { USD: 0.00075 } })).toBeNull()
    expect(parseFx({ base: 'EUR', date: 'yesterday', rates: { KRW: 1496 } })).toBeNull()
    expect(parseFx({ base: 'EUR', date: '2026-10-07', rates: { USD: 1.1 } })).toBeNull()
  })
  it('drops a rate outside the sane range', () => {
    const fx = parseFx({ base: 'EUR', date: '2026-10-07', rates: { KRW: 1496, USD: 1e-9 } })
    expect(fx?.rates.USD).toBeUndefined()
  })
})

describe('cron authorization fails closed (Security)', () => {
  const secret = 'a'.repeat(64)
  it('accepts the exact bearer token', () => expect(isAuthorized(`Bearer ${secret}`, secret)).toBe(true))
  it('rejects a wrong or missing token', () => {
    expect(isAuthorized(`Bearer ${'b'.repeat(64)}`, secret)).toBe(false)
    expect(isAuthorized(null, secret)).toBe(false)
    expect(isAuthorized(secret, secret)).toBe(false)
  })
  it('rejects everything when the secret is missing or short', () => {
    expect(isAuthorized('Bearer undefined', undefined)).toBe(false)
    expect(isAuthorized('Bearer ', '')).toBe(false)
    expect(isAuthorized(`Bearer ${'a'.repeat(31)}`, 'a'.repeat(31))).toBe(false)
  })
})
