import { describe, expect, it } from 'vitest'
import { collectionValue } from './collectionValue'

describe('collectionValue', () => {
  const prices = { 'me5-1': 120, 'me5-87': 182_400, 'me2-10': 41_200 }
  it('multiplies copies by the price and counts the cards without one', () => {
    const v = collectionValue(
      [
        { cardId: 'me5-1', count: 3 },
        { cardId: 'me5-87', count: 1 },
        { cardId: 'me2-10', count: 2 },
        { cardId: 'me4-5', count: 4 },
      ],
      prices,
    )
    expect(v.total).toBe(360 + 182_400 + 82_400)
    expect(v.priced).toBe(3)
    expect(v.unpriced).toBe(1)
    expect(v.top.map((t) => t.cardId)).toEqual(['me5-87', 'me2-10', 'me5-1'])
  })
  it('ignores inherited keys and empty input', () => {
    expect(collectionValue([{ cardId: 'constructor', count: 1 }], prices)).toEqual({ total: 0, priced: 0, unpriced: 1, top: [] })
    expect(collectionValue([], prices).total).toBe(0)
  })
  it('keeps at most topN, ties by id', () => {
    const v = collectionValue(
      [
        { cardId: 'b', count: 1 },
        { cardId: 'a', count: 1 },
      ],
      { a: 100, b: 100 },
      1,
    )
    expect(v.top).toEqual([{ cardId: 'a', count: 1, krw: 100 }])
  })
})
