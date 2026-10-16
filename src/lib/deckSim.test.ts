import { describe, expect, it } from 'vitest'
import { coverage, cryptoInt, deal, expand, HAND, odds, PRIZES, shuffle } from './deckSim'

/** A small seeded generator, so the counts are repeatable */
function seeded(seed: number) {
  let s = seed >>> 0
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n)
  }
}

/** 60 cards: `basics` Basic Pokémon (b0..), 4 copies of a target "t", the rest filler */
function deck(basics: number) {
  const ids = [...Array.from({ length: basics }, (_, i) => `b${i}`), 't', 't', 't', 't']
  while (ids.length < 60) ids.push(`x${ids.length}`)
  return ids
}
const isBasic = (id: string) => id.startsWith('b')

/** P(none of k copies among n cards drawn from 60), hypergeometric */
function none(k: number, n: number) {
  let p = 1
  for (let i = 0; i < n; i++) p *= (60 - k - i) / (60 - i)
  return p
}
const atLeastOne = (k: number, n: number) => 1 - none(k, n)
/** P(at least one of k targets in the 7 | the 7 has one of b Basics): a mulligan redraws until it does */
const targetGivenBasic = (k: number, b: number) => (1 - none(k, 7) - none(b, 7) + none(k + b, 7)) / (1 - none(b, 7))

describe('deck simulator', () => {
  it('shuffles without losing or adding cards', () => {
    const ids = deck(12)
    expect([...shuffle([...ids], seeded(1))].sort()).toEqual([...ids].sort())
  })

  it('picks crypto indexes in range', () => {
    for (const n of [1, 2, 7, 60]) {
      for (let i = 0; i < 200; i++) {
        const k = cryptoInt(n)
        expect(Number.isInteger(k) && k >= 0 && k < n).toBe(true)
      }
    }
  })

  it('deals 7 with a Basic, 6 prizes and the rest, counting mulligans', () => {
    const s = deal(deck(12), isBasic, seeded(2))!
    expect(s.hand).toHaveLength(HAND)
    expect(s.prizes).toHaveLength(PRIZES)
    expect(s.library).toHaveLength(60 - HAND - PRIZES)
    expect(s.hand.some(isBasic)).toBe(true)
    expect([...s.hand, ...s.prizes, ...s.library].sort()).toEqual(deck(12).sort())
    expect(deal(deck(0), isBasic, seeded(3))).toBeNull()
  })

  it('matches the exact odds within 1 percentage point', () => {
    const o = odds(deck(12), isBasic, 't', 20_000, seeded(4))!
    // 12 Basics: no mulligan ≈ 81.5%
    expect(Math.abs(o.noMulligan - atLeastOne(12, 7))).toBeLessThan(0.01)
    // The kept hand always has a Basic, which leaves a little less room for the target: conditional odds
    expect(Math.abs(o.target!.by7 - targetGivenBasic(4, 12))).toBeLessThan(0.01)
    expect(o.target!.by7).toBeLessThan(atLeastOne(4, 7))
    expect(o.target!.by7).toBeLessThan(o.target!.by8)
    expect(o.target!.by8).toBeLessThan(o.target!.by9)
    // All 4 copies among the 6 prizes is rare (≈ 0.03%)
    expect(o.target!.allPrized).toBeLessThan(0.002)
    expect(odds(deck(0), isBasic, null)).toBeNull()
  })

  it('collection coverage leaves basic Energy out of what is missing', () => {
    const cards = [
      { id: 'a', count: 4 },
      { id: 'b', count: 2 },
      { id: 'energy', count: 10 },
    ]
    const c = coverage(cards, new Map([['a', 3]]), (id) => id === 'energy')
    expect(c).toEqual({ covered: 13, total: 16, missing: [{ id: 'a', need: 1 }, { id: 'b', need: 2 }] })
    expect(expand([{ id: 'a', count: 2 }])).toEqual(['a', 'a'])
  })
})
