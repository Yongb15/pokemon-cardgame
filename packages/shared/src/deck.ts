// Deck rules shared by the web app (browser storage, pasted lists, share links) and the API server
// (account decks, imports): one sanitizer, so a deck is valid in the same way everywhere.

import { cleanText } from './text.js'

export const DECK_FORMATS = ['standard', 'expanded', 'unlimited'] as const
export type DeckFormat = (typeof DECK_FORMATS)[number]

export const DECK_SIZE = 60
export const MAX_COPIES = 4
export const MAX_DECK_NAME = 50
/** Decks per account, and per browser */
export const MAX_DECKS = 100
/** Distinct cards a deck can hold (one per slot of a 60-card deck) */
export const MAX_ENTRIES = DECK_SIZE
export const MAX_COUNT = DECK_SIZE
/** A card id as the card data has it ("sv3pt5-6", "swsh12pt5gg-GG01") */
export const CARD_ID = /^[\w.!?-]{1,40}$/

export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 20

export interface DeckCard {
  id: string
  count: number
}

export const isDeckFormat = (value: unknown): value is DeckFormat =>
  typeof value === 'string' && (DECK_FORMATS as readonly string[]).includes(value)

export const isCardId = (value: unknown): value is string => typeof value === 'string' && CARD_ID.test(value)

/** A card count in a deck: a whole number from 1 to 60 */
export const isCardCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_COUNT

/**
 * Collapses spacing and drops invisible control/format characters (e.g. U+202E, which flips the
 * text after it so "gnp.exe" reads "exe.png"), keeping the zero-width joiner emoji are built with
 */
export const cleanDeckName = (name: string) => cleanText(name, MAX_DECK_NAME)

/** A nickname after cleaning, or null when fewer than 2 characters are left */
export function cleanNickname(name: string) {
  const clean = cleanText(name, NICKNAME_MAX)
  return [...clean].length >= NICKNAME_MIN ? clean : null
}

/** Merges duplicate ids, drops invalid entries and caps the number of distinct cards */
export function sanitizeCards(raw: unknown): DeckCard[] {
  if (!Array.isArray(raw)) return []
  const counts = new Map<string, number>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, count } = entry as Record<string, unknown>
    if (!isCardId(id) || !isCardCount(count)) continue
    if (!counts.has(id) && counts.size >= MAX_ENTRIES) continue
    counts.set(id, Math.min(MAX_COUNT, (counts.get(id) ?? 0) + count))
  }
  return [...counts].map(([id, count]) => ({ id, count }))
}

/**
 * Strict check for what a signed-in user sends (the API rejects instead of repairing): at most
 * MAX_ENTRIES entries, each a valid id with a count of 1–60, no id twice
 */
export function validCards(raw: unknown): raw is DeckCard[] {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) return false
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const keys = Object.keys(entry)
    const { id, count } = entry as Record<string, unknown>
    if (keys.length !== 2 || !isCardId(id) || !isCardCount(count) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}
