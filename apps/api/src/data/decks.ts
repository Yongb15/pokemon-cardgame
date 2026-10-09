// What a signed-in user may send about decks, and how browser decks become account decks
// (docs/auth/design.md §5 and the qa review: I-1, I-2, name clashes, the 100-deck limit).

import {
  cleanDeckName,
  cleanText,
  DECK_FORMATS,
  isDeckFormat,
  MAX_DECK_NAME,
  MAX_DECKS,
  sanitizeCards,
  validCards,
  type DeckCard,
  type DeckFormat,
} from '@card-dex/shared'
import { z } from 'zod'

export interface DeckInput {
  name: string
  format: DeckFormat
  cards: DeckCard[]
}

export interface DeckRecord extends DeckInput {
  id: string
  version: number
  updatedAt: Date
}

/** The JSON a client gets: no user id, the version to send back with the next save */
export const deckView = (d: DeckRecord) => ({
  id: d.id,
  name: d.name,
  format: d.format,
  cards: d.cards,
  version: d.version,
  updatedAt: d.updatedAt.toISOString(),
})

// Strict objects: an unknown field is an error, not something silently stored (Security)
const deckBody = z.strictObject({
  // Long enough for any name that cleans down to 50 characters; cleaned and checked below
  name: z.string().max(MAX_DECK_NAME * 4),
  format: z.enum(DECK_FORMATS),
  cards: z.unknown(),
})
const updateBody = deckBody.extend({ version: z.number().int().min(1).max(2_147_483_647) })

/** A new or saved deck, or null when the body isn't one (400) */
export function parseDeck(body: unknown): DeckInput | null {
  const parsed = deckBody.safeParse(body)
  if (!parsed.success) return null
  return deckInput(parsed.data)
}

export function parseDeckUpdate(body: unknown): (DeckInput & { version: number }) | null {
  const parsed = updateBody.safeParse(body)
  if (!parsed.success) return null
  const input = deckInput(parsed.data)
  return input && { ...input, version: parsed.data.version }
}

/** A signed-in save is refused, not cut, when the cleaned name is over 50 characters (qa D5-3) */
function deckInput(data: { name: string; format: DeckFormat; cards: unknown }): DeckInput | null {
  const name = cleanText(data.name, MAX_DECK_NAME * 4)
  if (!name || [...name].length > MAX_DECK_NAME || !validCards(data.cards)) return null
  return { name, format: data.format, cards: data.cards }
}

// --- Importing browser decks ---------------------------------------------------------------------

/** A browser deck's id (crypto.randomUUID, or the fallback "time-random") */
export const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_NAME = '가져온 덱'

export interface ImportItem extends DeckInput {
  sourceId: string
  updatedAt: number
}

/**
 * The import body: { decks: [...] } with at most MAX_DECKS items. Each item is repaired like the
 * browser repairs its own storage (they're the user's own decks, perhaps from an older version);
 * an item without a usable id is counted as invalid. The same browser deck twice counts once.
 */
export function parseImport(body: unknown): { items: ImportItem[]; invalid: number } | null {
  const parsed = z.strictObject({ decks: z.array(z.unknown()).max(MAX_DECKS) }).safeParse(body)
  if (!parsed.success) return null
  const items = new Map<string, ImportItem>()
  let invalid = 0
  for (const raw of parsed.data.decks) {
    const d = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    if (typeof d.sourceId !== 'string' || !SOURCE_ID.test(d.sourceId)) {
      invalid++
      continue
    }
    items.set(d.sourceId, {
      sourceId: d.sourceId,
      name: (typeof d.name === 'string' && cleanDeckName(d.name)) || DEFAULT_NAME,
      format: isDeckFormat(d.format) ? d.format : 'standard',
      cards: sanitizeCards(d.cards),
      updatedAt: typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) ? d.updatedAt : 0,
    })
  }
  return { items: [...items.values()], invalid }
}

/** "이름 (가져옴)", "이름 (가져옴 2)"…, the name cut first so the whole stays within 50 characters */
export function importedName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (가져옴)' : ` (가져옴 ${n})`
    const base = [...name].slice(0, MAX_DECK_NAME - [...suffix].length).join('').trimEnd()
    const candidate = base + suffix
    if (!taken.has(candidate)) return candidate
  }
}

export interface ImportPlan {
  insert: (DeckInput & { sourceId: string })[]
  /** Browser decks this account already has (imported before, from here or another browser) */
  duplicates: string[]
  /** Left in the browser: the account is at its deck limit */
  overLimit: string[]
}

/** Newest first into the free slots; the rest stay in the browser (qa) */
export function planImport(items: ImportItem[], existing: { sourceIds: Set<string>; names: Set<string>; count: number }): ImportPlan {
  const plan: ImportPlan = { insert: [], duplicates: [], overLimit: [] }
  const names = new Set(existing.names)
  const room = Math.max(0, MAX_DECKS - existing.count)
  for (const item of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (existing.sourceIds.has(item.sourceId)) plan.duplicates.push(item.sourceId)
    else if (plan.insert.length >= room) plan.overLimit.push(item.sourceId)
    else {
      const name = importedName(item.name, names)
      names.add(name)
      plan.insert.push({ sourceId: item.sourceId, name, format: item.format, cards: item.cards })
    }
  }
  return plan
}
