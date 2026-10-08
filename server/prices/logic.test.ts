import { describe, expect, it } from 'vitest'
import {
  addDays,
  cleanPrice,
  daysBetween,
  decideOutlier,
  headlineVariant,
  isRefreshDue,
  isUsableRate,
  median,
  rateOn,
  toKrw,
  utcDay,
  type LevelRow,
} from './logic.ts'

describe('UTC days (qa D-2)', () => {
  it('uses the UTC date, not Korean time', () => {
    // 2026-10-08 08:59 KST is still 10-07 in UTC
    expect(utcDay(new Date('2026-10-07T23:59:00Z'))).toBe('2026-10-07')
    expect(utcDay(new Date('2026-10-08T00:00:00Z'))).toBe('2026-10-08')
  })
  it('counts days between dates across months', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2)
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  })
})

describe('refresh once per 24 hours', () => {
  const at = new Date('2026-10-07T12:00:00Z')
  it('is due with no previous refresh', () => expect(isRefreshDue(null, at)).toBe(true))
  it('is not due at 23h59m', () => expect(isRefreshDue(at, new Date('2026-10-08T11:59:00Z'))).toBe(false))
  it('is due at exactly 24h', () => expect(isRefreshDue(at, new Date('2026-10-08T12:00:00Z'))).toBe(true))
  it('is due at 24h01m', () => expect(isRefreshDue(at, new Date('2026-10-08T12:01:00Z'))).toBe(true))
  it('is never due while refreshed_at is in the future (the qa seed uses 2099)', () =>
    expect(isRefreshDue(new Date('2099-01-01T00:00:00Z'), at)).toBe(false))
})

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('outliers (qa D-5)', () => {
  const normal = (market: number, days = 1): LevelRow => ({ market, flagged: false, days })
  const flagged = (market: number, days = 1): LevelRow => ({ market, flagged: true, days })

  it('accepts the first value (nothing to compare with)', () => {
    expect(decideOutlier([], 999)).toEqual({ flagged: false, acceptRun: 0 })
  })
  it('accepts a value within 10× of the recent median', () => {
    expect(decideOutlier([normal(3), normal(3.2), normal(2.8)], 29)).toEqual({ flagged: false, acceptRun: 0 })
  })
  it('flags a one-day 10× spike', () => {
    expect(decideOutlier([normal(3), normal(3.1), normal(2.9)], 40)).toEqual({ flagged: true })
  })
  it('flags a drop below a tenth', () => {
    expect(decideOutlier([normal(3), normal(3.1), normal(2.9)], 0.2)).toEqual({ flagged: true })
  })
  it('compares with the median, not just the last value', () => {
    // The last level is 1, but the median of the recent ones is 3: 25 is within 10× of 3
    expect(decideOutlier([normal(3), normal(3), normal(1)], 25)).toEqual({ flagged: false, acceptRun: 0 })
  })
  it('accepts a new level on the 3rd day in a row within ±20%', () => {
    const history = [normal(3), normal(3), flagged(40), flagged(44)]
    expect(decideOutlier(history, 42)).toEqual({ flagged: false, acceptRun: 2 })
  })
  it('counts days a level was seen again, not just rows', () => {
    // One flagged row seen on 2 days + today = 3
    expect(decideOutlier([normal(3), flagged(40, 2)], 40)).toEqual({ flagged: false, acceptRun: 1 })
  })
  it('keeps flagging on day 2', () => {
    expect(decideOutlier([normal(3), flagged(40)], 41)).toEqual({ flagged: true })
  })
  it('restarts the count when a value in the run is outside ±20%', () => {
    // 40 → 60 (+50%) breaks the run, so day 3 is not reached
    expect(decideOutlier([normal(3), flagged(40), flagged(60)], 41)).toEqual({ flagged: true })
  })
  it('restarts the count when today is outside ±20% of the run', () => {
    expect(decideOutlier([normal(3), flagged(40), flagged(42)], 49)).toEqual({ flagged: true })
  })
  it('does not flag exactly 10× or exactly a tenth (both inclusive)', () => {
    const h = [normal(3), normal(3), normal(3)]
    expect(decideOutlier(h, 30)).toEqual({ flagged: false, acceptRun: 0 })
    expect(decideOutlier(h, 0.3)).toEqual({ flagged: false, acceptRun: 0 })
  })
  it('uses only the last 7 normal levels as the baseline', () => {
    // Eight levels: the oldest (100) drops out, so the median is 3 and 31 is flagged
    const h = [normal(100), normal(3), normal(3), normal(3), normal(3), normal(3), normal(3), normal(3)]
    expect(decideOutlier(h, 31)).toEqual({ flagged: true })
  })
  it('leaves old flagged rows out of the baseline', () => {
    expect(decideOutlier([normal(3), flagged(40), normal(3), normal(3)], 40)).toEqual({ flagged: true })
  })
  it('accepts a new lower level on the 3rd day', () => {
    expect(decideOutlier([normal(30), normal(30), flagged(2), flagged(2.2)], 2.1)).toEqual({ flagged: false, acceptRun: 2 })
  })
  it('breaks the run on a normal row in between', () => {
    expect(decideOutlier([normal(3), flagged(40), normal(3), flagged(40)], 40)).toEqual({ flagged: true })
  })
  it('counts several one-day rows together', () => {
    expect(decideOutlier([normal(3), flagged(40, 1), flagged(41, 1)], 40)).toEqual({ flagged: false, acceptRun: 2 })
  })
  it('accepts exactly at the +20% edge', () => {
    expect(decideOutlier([normal(3), flagged(40), flagged(40)], 48)).toEqual({ flagged: false, acceptRun: 2 })
  })
})

describe('exchange rates (qa D-1)', () => {
  const rates = [
    { rateDate: '2026-10-02', krwPerUnit: 1330, usable: true }, // Friday
    { rateDate: '2026-10-05', krwPerUnit: 1500, usable: false }, // jumped: stored, not used
    { rateDate: '2026-10-06', krwPerUnit: 1338, usable: true },
  ]
  it('uses Friday’s rate on the weekend', () => {
    expect(rateOn(rates, '2026-10-04')?.rateDate).toBe('2026-10-02')
  })
  it('skips unusable rates', () => {
    expect(rateOn(rates, '2026-10-05')?.rateDate).toBe('2026-10-02')
  })
  it('has no rate before the first one', () => expect(rateOn(rates, '2026-09-01')).toBeNull())
  it('falls back past an unusable Monday into the next weekend', () => {
    const r = [
      { rateDate: '2026-10-02', krwPerUnit: 1330, usable: true }, // Fri
      { rateDate: '2026-10-05', krwPerUnit: 1700, usable: false }, // Mon, unusable
    ]
    expect(rateOn(r, '2026-10-10')?.rateDate).toBe('2026-10-02') // Sat after
  })
  it('rejects a rate more than 20% away from the last good one', () => {
    expect(isUsableRate(1330, 1596)).toBe(true) // +20%
    expect(isUsableRate(1330, 1597)).toBe(false)
    expect(isUsableRate(1330, 1064)).toBe(true) // −20%
    expect(isUsableRate(1330, 1063)).toBe(false)
    expect(isUsableRate(null, 1330)).toBe(true)
    expect(isUsableRate(1330, Number.NaN)).toBe(false)
  })
})

describe('display', () => {
  it('picks the headline variant normal → holo → reverse (qa D-6)', () => {
    expect(headlineVariant(['reverse', 'normal'])).toBe('normal')
    expect(headlineVariant(['reverse', 'holo'])).toBe('holo')
    expect(headlineVariant(['firstEdition', 'unlimited'])).toBe('unlimited')
    expect(headlineVariant([])).toBeNull()
  })
  it('rounds won to 10 and marks values below ₩10 (not "no price": qa N-1)', () => {
    expect(toKrw(3.05, 1338.69)).toEqual({ krw: 4080, belowMin: false })
    expect(toKrw(0.005, 1338.69)).toEqual({ krw: null, belowMin: true })
    expect(toKrw(1000, 1338.69)).toEqual({ krw: 1338690, belowMin: false })
  })
})

describe('outside data (Security)', () => {
  it('keeps only finite prices in [0, 100000]', () => {
    expect(cleanPrice(3.05)).toBe(3.05)
    expect(cleanPrice(100_000)).toBe(100_000)
    for (const bad of [0, -1, 100_001, Number.NaN, Infinity, '3', null, undefined]) expect(cleanPrice(bad)).toBeNull()
  })
})
