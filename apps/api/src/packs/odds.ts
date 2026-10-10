// Card-pack odds and the draw (docs/auction/packs.md §1, Security K-1). Integer weights only, drawn
// with randomInt(0, total): no floats, no Math.random. The odds the /packs page shows come from the
// same constants (packOdds), so what's shown is what's drawn.

import { randomInt } from 'node:crypto'
import pool from './pool.json' with { type: 'json' }

/** The rare slot's tiers and their weights out of 100,000 */
export const RARE_SLOT = [
  ['rare', 60_000],
  ['double', 18_000],
  ['illustration', 12_000],
  ['ultra', 6_000],
  ['sir', 3_000],
  ['hyper', 1_000],
] as const
export type RareTier = (typeof RARE_SLOT)[number][0]
export type Tier = 'common' | 'uncommon' | RareTier

export const PACK_PRICE = 1_000
export const PACK_SIZE = 5

export interface PackSet {
  id: string
  nameKo: string
  releaseDate: string
  tiers: Partial<Record<Tier, string[]>>
}

export const PACK_SETS: PackSet[] = pool.sets as PackSet[]
const BY_ID = new Map(PACK_SETS.map((s) => [s.id, s]))
export const packSet = (id: string) => BY_ID.get(id) ?? null

/** Every card id a pack can give (the only ids the test hook accepts: Security K-3) */
export const POOL_IDS = new Set(PACK_SETS.flatMap((s) => Object.values(s.tiers).flat()))

/** A source of integers in [0, max): crypto in production, a seeded one only for preview tests */
export type Rng = (max: number) => number
export const cryptoRng: Rng = (max) => randomInt(0, max)

/** Deterministic integers for preview tests (mulberry32); built only behind the test gate */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const u32 = (t ^ (t >>> 14)) >>> 0
    return u32 % max
  }
}

/**
 * The rare slot's weights for one set: tiers the set doesn't have are dropped and their share is
 * spread over the rest in proportion (integers out of 100,000, the remainder on the largest)
 */
export function rareWeights(set: PackSet): [RareTier, number][] {
  const present = RARE_SLOT.filter(([tier]) => (set.tiers[tier]?.length ?? 0) > 0)
  const sum = present.reduce((n, [, w]) => n + w, 0)
  const scaled = present.map(([tier, w]): [RareTier, number] => [tier, Math.floor((w * 100_000) / sum)])
  const left = 100_000 - scaled.reduce((n, [, w]) => n + w, 0)
  scaled[0]![1] += left
  return scaled
}

/** The odds as the page shows them: percent with one decimal, adding up to exactly 100.0 */
export function packOdds(set: PackSet) {
  return rareWeights(set).map(([tier, w]) => ({ tier, percent: w / 1000, cards: set.tiers[tier]!.length }))
}

function pick(list: string[], rng: Rng) {
  return list[rng(list.length)]!
}

export interface DrawnCard {
  cardId: string
  tier: Tier
  /** The fifth card, from the rare slot */
  rareSlot: boolean
}

/** Five cards: common ×3, uncommon ×1, then the rare slot by weight (slots are independent) */
export function drawPack(set: PackSet, rng: Rng = cryptoRng): DrawnCard[] {
  const cards: DrawnCard[] = []
  for (let i = 0; i < 3; i++) cards.push({ cardId: pick(set.tiers.common!, rng), tier: 'common', rareSlot: false })
  cards.push({ cardId: pick(set.tiers.uncommon!, rng), tier: 'uncommon', rareSlot: false })
  const weights = rareWeights(set)
  let roll = rng(100_000)
  let tier: RareTier = weights[0]![0]
  for (const [t, w] of weights) {
    if (roll < w) {
      tier = t
      break
    }
    roll -= w
  }
  cards.push({ cardId: pick(set.tiers[tier]!, rng), tier, rareSlot: true })
  return cards
}
