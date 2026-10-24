import { describe, expect, it } from 'vitest'
import { BUNDLE_SIZE, CRAFT_FACTOR, drawBundle, drawPack, EXCHANGE_VALUE, guaranteeOdds, guaranteeWeights, isUltraPlus, PACK_PRICE, PACK_SETS, packOdds, rareWeights, RARE_SLOT, seededRng, tierOf, type PackSet } from './odds.js'

describe('pack odds (Security K-1)', () => {
  it('shows exactly the weights it draws with, adding up to 100%, for every set', () => {
    for (const set of PACK_SETS) {
      const odds = packOdds(set)
      expect(odds.reduce((n, o) => n + o.percent * 1000, 0), set.id).toBe(100_000)
      expect(odds.map((o) => o.tier)).toEqual(rareWeights(set).map(([t]) => t))
    }
  })

  it('spreads a missing tier over the others in proportion, in integers', () => {
    const set: PackSet = { id: 'x', nameKo: 'x', releaseDate: '', tiers: { common: ['c'], uncommon: ['u'], rare: ['r'], double: ['d'], ultra: ['u2'] } }
    const w = Object.fromEntries(rareWeights(set))
    expect(Object.keys(w)).toEqual(['rare', 'double', 'ultra'])
    expect(w.rare! + w.double! + w.ultra!).toBe(100_000)
    expect(w.double! / w.ultra!).toBeCloseTo(3, 2)
  })

  it('draws 3 commons, 1 uncommon and a rare-slot card from the set', () => {
    const set = PACK_SETS[0]!
    const pack = drawPack(set, seededRng(7))
    expect(pack.map((c) => c.tier).slice(0, 4)).toEqual(['common', 'common', 'common', 'uncommon'])
    expect(pack[4]!.rareSlot).toBe(true)
    for (const c of pack) expect(set.tiers[c.tier]).toContain(c.cardId)
  })

  it('matches the published odds over 100,000 seeded packs (±0.5%p)', () => {
    const set = PACK_SETS[0]!
    const rng = seededRng(20261010)
    const counts = new Map<string, number>()
    const n = 100_000
    for (let i = 0; i < n; i++) {
      const tier = drawPack(set, rng)[4]!.tier
      counts.set(tier, (counts.get(tier) ?? 0) + 1)
    }
    for (const o of packOdds(set)) {
      expect(Math.abs(((counts.get(o.tier) ?? 0) / n) * 100 - o.percent), o.tier).toBeLessThan(0.5)
    }
    // Every published tier of this set shows up, nothing else does
    expect([...counts.keys()].sort()).toEqual(RARE_SLOT.map(([t]) => t).filter((t) => set.tiers[t]?.length).sort())
  })
})

describe('10 packs and the guarantee (exchange.md §1, Security X-8)', () => {
  it('shows the guarantee from the weights the tenth pack draws with, for every set', () => {
    for (const set of PACK_SETS) {
      const odds = guaranteeOdds(set)
      expect(odds.reduce((n, o) => n + o.percent * 1000, 0), set.id).toBe(100_000)
      expect(odds.map((o) => o.tier)).toEqual(guaranteeWeights(set).map(([t]) => t))
      expect(odds.every((o) => isUltraPlus(o.tier))).toBe(true)
    }
  })

  it('always has an ultra or better in ten packs, and uses the guarantee only when the nine had none', () => {
    const set = PACK_SETS[0]!
    let guaranteed = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const b = drawBundle(set, seededRng(seed))
      expect(b.packs).toHaveLength(BUNDLE_SIZE)
      expect(b.packs.flat()).toHaveLength(BUNDLE_SIZE * 5)
      expect(b.packs.some((p) => p.some((c) => isUltraPlus(c.tier)))).toBe(true)
      const nineHadOne = b.packs.slice(0, 9).some((p) => p.some((c) => isUltraPlus(c.tier)))
      expect(b.guaranteed).toBe(!nineHadOne)
      if (b.guaranteed) guaranteed++
    }
    // Nine packs without an ultra or better: 0.9^9 ≈ 38.7% of bundles
    expect(guaranteed / 2000).toBeGreaterThan(0.34)
    expect(guaranteed / 2000).toBeLessThan(0.43)
  })
})

describe('exchange and craft values (exchange.md §2, Security X-6)', () => {
  /** Expected exchange points of one pack: 3 commons, 1 uncommon and the rare slot by its weights */
  const packValue = (set: PackSet, rare = rareWeights(set)) =>
    3 * EXCHANGE_VALUE.common + EXCHANGE_VALUE.uncommon + rare.reduce((n, [tier, w]) => n + (w / 100_000) * EXCHANGE_VALUE[tier], 0)

  it('a pack exchanged in full gives back at most 40% of its price: buying to exchange never makes points', () => {
    for (const set of PACK_SETS) {
      const one = packValue(set)
      expect(one, set.id).toBeLessThanOrEqual(0.4 * PACK_PRICE)
      // Ten packs with the guarantee: nine plain, the tenth plain or (when the nine had none) guaranteed
      const plainUltra = rareWeights(set).filter(([t]) => isUltraPlus(t)).reduce((n, [, w]) => n + w / 100_000, 0)
      const noneInNine = (1 - plainUltra) ** 9
      const ten = 9 * one + (1 - noneInNine) * one + noneInNine * packValue(set, guaranteeWeights(set))
      expect(ten, set.id).toBeLessThanOrEqual(0.4 * BUNDLE_SIZE * PACK_PRICE)
    }
  })

  it('crafting costs ten times the exchange value, so exchange → craft can only lose points', () => {
    expect(CRAFT_FACTOR).toBeGreaterThanOrEqual(10)
    for (const [, value] of Object.entries(EXCHANGE_VALUE)) expect(value).toBeGreaterThan(0)
    const first = PACK_SETS[0]!
    for (const [tier, ids] of Object.entries(first.tiers)) expect(tierOf(ids![0]!)).toBe(tier)
    expect(tierOf('nope-1')).toBeNull()
  })
})
