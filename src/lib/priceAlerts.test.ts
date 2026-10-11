import { describe, expect, it } from 'vitest'
import { alertDefault, alertStep } from './priceAlerts'

describe('price alert targets', () => {
  it('goes the given percent under the price, down to whole hundreds', () => {
    expect(alertDefault(52_300)).toBe(47_000)
    expect(alertStep(52_300, 5)).toBe(49_600)
    expect(alertStep(52_300, 20)).toBe(41_800)
  })
  it('stays within ₩100 and ₩100,000,000', () => {
    expect(alertDefault(90)).toBe(100)
    expect(alertDefault(500_000_000)).toBe(100_000_000)
  })
})
