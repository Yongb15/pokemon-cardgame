import { describe, expect, it } from 'vitest'
import { drawPack, PACK_SETS, packOdds, rareWeights, RARE_SLOT, seededRng, type PackSet } from './odds.js'

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
