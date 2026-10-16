// Solo deck practice (docs/deck/simulator.md): shuffle, the opening hand with mulligans, prizes, draws,
// and Monte Carlo odds. No game rules beyond setup. Plus how much of a deck the user's collection covers.

import type { DeckCard } from './deck'

export const HAND = 7
export const PRIZES = 6
export const SIM_DECK = 60
export const SIM_RUNS = 20_000

/** A whole number in [0, n) */
export type RandInt = (n: number) => number

/** From the browser's crypto source with rejection sampling, so no index is favoured (Security D-3) */
export const cryptoInt: RandInt = (n) => {
  const limit = 2 ** 32 - (2 ** 32 % n)
  const a = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(a)
    if (a[0]! < limit) return a[0]! % n
  }
}

/** Fast and good enough for counting odds */
export const mathInt: RandInt = (n) => Math.floor(Math.random() * n)

/** Fisher–Yates in place */
export function shuffle<T>(items: T[], rand: RandInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

/** One entry per copy, in deck order */
export const expand = (cards: DeckCard[]) => cards.flatMap((c) => Array.from({ length: c.count }, () => c.id))

export interface Setup {
  hand: string[]
  prizes: string[]
  /** What is left to draw, top first */
  library: string[]
  mulligans: number
}

/** More than this many mulligans in a row means something is off; the caller has already checked for Basics */
const MAX_MULLIGANS = 1000

/**
 * The game's setup: shuffle and draw 7 until the hand has a Basic Pokémon (each redraw is a mulligan), then
 * 6 prizes from the top. null when the deck has no Basic Pokémon at all (it could never start).
 */
export function deal(ids: string[], isBasic: (id: string) => boolean, rand: RandInt): Setup | null {
  if (!ids.some(isBasic)) return null
  const deck = [...ids]
  let mulligans = 0
  for (;;) {
    shuffle(deck, rand)
    if (deck.slice(0, HAND).some(isBasic)) break
    if (++mulligans > MAX_MULLIGANS) return null
  }
  return { hand: deck.slice(0, HAND), prizes: deck.slice(HAND, HAND + PRIZES), library: deck.slice(HAND + PRIZES), mulligans }
}

export interface Odds {
  /** Opening 7 has a Basic: no mulligan */
  noMulligan: number
  averageMulligans: number
  /** For the chosen card: seen at least once by 7 / 8 / 9 cards, and every copy prized */
  target: { by7: number; by8: number; by9: number; allPrized: number } | null
}

/** Shuffle `runs` times with the same setup rules and count (fast random is fine for counting) */
export function odds(ids: string[], isBasic: (id: string) => boolean, targetId: string | null, runs = SIM_RUNS, rand: RandInt = mathInt): Odds | null {
  if (!ids.some(isBasic)) return null
  let clean = 0
  let mulligans = 0
  let by7 = 0
  let by8 = 0
  let by9 = 0
  let allPrized = 0
  const copies = targetId ? ids.filter((id) => id === targetId).length : 0
  for (let r = 0; r < runs; r++) {
    const s = deal(ids, isBasic, rand)!
    if (s.mulligans === 0) clean++
    mulligans += s.mulligans
    if (!targetId) continue
    const inHand = s.hand.includes(targetId)
    const seen8 = inHand || s.library[0] === targetId
    const seen9 = seen8 || s.library[1] === targetId
    if (inHand) by7++
    if (seen8) by8++
    if (seen9) by9++
    if (s.prizes.filter((id) => id === targetId).length === copies) allPrized++
  }
  return {
    noMulligan: clean / runs,
    averageMulligans: mulligans / runs,
    target: targetId ? { by7: by7 / runs, by8: by8 / runs, by9: by9 / runs, allPrized: allPrized / runs } : null,
  }
}

export interface Coverage {
  /** Deck cards the collection covers (basic Energy always counts as covered) */
  covered: number
  total: number
  missing: { id: string; need: number }[]
}

/** How much of the deck the user's own cards cover; basic Energy is treated as unlimited (simulator.md §1) */
export function coverage(cards: DeckCard[], owned: Map<string, number>, isBasicEnergy: (id: string) => boolean): Coverage {
  let covered = 0
  let total = 0
  const missing: Coverage['missing'] = []
  for (const c of cards) {
    total += c.count
    const have = isBasicEnergy(c.id) ? c.count : Math.min(c.count, owned.get(c.id) ?? 0)
    covered += have
    if (have < c.count) missing.push({ id: c.id, need: c.count - have })
  }
  return { covered, total, missing }
}
