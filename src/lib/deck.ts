// Decks: the saved shape, the deck rules, Pokémon TCG Live text lists and share links.
// Everything that comes from outside (storage, a pasted list, a link) goes through the same
// sanitizer, so a tampered value can only ever become a smaller, valid deck.

import bundledSets from '../data/sets.json'
import type { CardListItem } from '../types/card'

export const FORMATS = {
  standard: '스탠다드',
  expanded: '익스팬디드',
  unlimited: '언리미티드',
} as const
export type DeckFormat = keyof typeof FORMATS

export const DECK_SIZE = 60
export const MAX_COPIES = 4
export const MAX_DECK_NAME = 50
/** Distinct cards a deck can hold (one per slot of a 60-card deck) */
const MAX_ENTRIES = DECK_SIZE
const MAX_COUNT = DECK_SIZE
const ID_PATTERN = /^[\w.!?-]{1,40}$/

export interface DeckCard {
  id: string
  count: number
}

export interface Deck {
  id: string
  name: string
  format: DeckFormat
  cards: DeckCard[]
  updatedAt: number
  /** Saved by the editor so the deck list can show a cover and the rule status without fetching */
  coverId?: string
  problems?: number
}

export const isDeckFormat = (value: unknown): value is DeckFormat =>
  typeof value === 'string' && Object.hasOwn(FORMATS, value)

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_COUNT

/**
 * Collapses spacing and drops invisible control/format characters (e.g. U+202E, which flips the
 * text after it so "gnp.exe" reads "exe.png"), keeping the zero-width joiner emoji are built with
 */
export function cleanDeckName(name: string) {
  const clean = name
    .replace(/\s+/g, ' ') // tabs and newlines become spaces before the other controls go
    .replace(/(?!‍)[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ') // "a <ZWSP> b" left two spaces
    .slice(0, MAX_DECK_NAME)
    .trim() // after cutting, so a space at the 50th character doesn't stay at the end
  // Nothing visible left (only joiners): treat as no name, so callers fall back to a default
  return /^[\s‍]*$/.test(clean) ? '' : clean
}

/** Merges duplicate ids, drops invalid entries and caps the number of distinct cards */
export function sanitizeCards(raw: unknown): DeckCard[] {
  if (!Array.isArray(raw)) return []
  const counts = new Map<string, number>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, count } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || !isCount(count)) continue
    if (!counts.has(id) && counts.size >= MAX_ENTRIES) continue
    counts.set(id, Math.min(MAX_COUNT, (counts.get(id) ?? 0) + count))
  }
  return [...counts].map(([id, count]) => ({ id, count }))
}

function sanitizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.id !== 'string' || !/^[\w-]{1,64}$/.test(d.id)) return null
  return {
    id: d.id,
    name: typeof d.name === 'string' ? cleanDeckName(d.name) : '',
    format: isDeckFormat(d.format) ? d.format : 'standard',
    cards: sanitizeCards(d.cards),
    updatedAt: Number.isFinite(d.updatedAt) ? (d.updatedAt as number) : 0,
    ...(typeof d.coverId === 'string' && ID_PATTERN.test(d.coverId) && { coverId: d.coverId }),
    ...(Number.isInteger(d.problems) && { problems: d.problems as number }),
  }
}

export const deckSize = (cards: DeckCard[]) => cards.reduce((n, c) => n + c.count, 0)

export function newDeckId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// --- Storage ------------------------------------------------------------------------------------

const STORAGE_KEY = 'card-dex:decks'
const STORAGE_VERSION = 1
const MAX_DECKS = 100

let cache: Deck[] | null = null
const listeners = new Set<() => void>()

/** Saved decks, newest first. Unreadable or blocked storage reads as no decks. */
export function loadDecks(): Deck[] {
  if (cache) return cache
  let decks: Deck[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).version === STORAGE_VERSION) {
      const list = (raw as Record<string, unknown>).decks
      if (Array.isArray(list)) decks = list.slice(0, MAX_DECKS).map(sanitizeDeck).filter((d): d is Deck => !!d)
    }
  } catch {
    // corrupt JSON or storage blocked: start empty (and don't overwrite it until the user saves)
  }
  cache = decks.sort((a, b) => b.updatedAt - a.updatedAt)
  return cache
}

/** Throws if the browser refuses to store (private mode, quota): the caller tells the user */
function saveDecks(decks: Deck[]) {
  const sorted = [...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DECKS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, decks: sorted }))
  cache = sorted
  listeners.forEach((l) => l())
}

export function subscribeDecks(listener: () => void) {
  listeners.add(listener)
  // Another tab changed the decks
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function putDeck(deck: Deck) {
  saveDecks([{ ...deck, updatedAt: Date.now() }, ...loadDecks().filter((d) => d.id !== deck.id)])
}

export function deleteDeck(id: string) {
  saveDecks(loadDecks().filter((d) => d.id !== id))
}

export function createDeck(init: Partial<Pick<Deck, 'name' | 'format' | 'cards'>> = {}): Deck {
  const deck: Deck = {
    id: newDeckId(),
    name: cleanDeckName(init.name ?? '') || '새 덱',
    format: init.format ?? 'standard',
    cards: sanitizeCards(init.cards ?? []),
    updatedAt: Date.now(),
  }
  putDeck(deck)
  return deck
}

// --- Rules --------------------------------------------------------------------------------------

export const isBasicEnergy = (c: Pick<CardListItem, 'supertype' | 'subtypes'>) =>
  c.supertype === 'Energy' && !!c.subtypes?.includes('Basic')
const isBasicPokemon = (c: CardListItem) => c.supertype === 'Pokémon' && !!c.subtypes?.includes('Basic')

/** The name the four-copy rule counts by: "Professor's Research (Professor Oak)" is "Professor's Research" */
export const ruleName = (name: string) => name.replace(/\s*\(.*\)$/, '')
const displayName = (c: CardListItem) => ruleName(c.nameKo ?? c.name)

/** One line of the checklist: `lead` + bold `strong` (a card name or a number) + `rest` */
export interface RuleCheck {
  ok: boolean
  lead?: string
  strong?: string
  rest?: string
}

export const problemCount = (checks: RuleCheck[]) => checks.filter((c) => !c.ok).length

/** Copies of each rule name in the deck, for disabling "+" at four */
export function copiesByName(cards: DeckCard[], info: Map<string, CardListItem>) {
  const byName = new Map<string, number>()
  for (const { id, count } of cards) {
    const c = info.get(id)
    if (c) byName.set(ruleName(c.name), (byName.get(ruleName(c.name)) ?? 0) + count)
  }
  return byName
}

/** The deck-building rules, as a checklist. Cards whose details haven't loaded are skipped. */
export function checkDeck(cards: DeckCard[], format: DeckFormat, info: Map<string, CardListItem>): RuleCheck[] {
  const checks: RuleCheck[] = []
  const total = deckSize(cards)
  const known = cards.flatMap(({ id, count }) => {
    const c = info.get(id)
    return c ? [{ card: c, count }] : []
  })

  if (total === DECK_SIZE) checks.push({ ok: true, lead: `${DECK_SIZE}장` })
  else if (total < DECK_SIZE) checks.push({ ok: false, lead: `${DECK_SIZE}장이 되려면 `, strong: `${DECK_SIZE - total}장`, rest: ' 더 필요해요' })
  else checks.push({ ok: false, lead: `${DECK_SIZE}장을 넘었어요. `, strong: `${total - DECK_SIZE}장`, rest: '을 빼 주세요' })

  const byName = new Map<string, { label: string; count: number }>()
  for (const { card, count } of known) {
    if (isBasicEnergy(card)) continue
    const key = ruleName(card.name)
    const entry = byName.get(key) ?? { label: displayName(card), count: 0 }
    entry.count += count
    byName.set(key, entry)
  }
  const over = [...byName.values()].filter((e) => e.count > MAX_COPIES)
  for (const e of over) checks.push({ ok: false, strong: e.label, rest: ` ${e.count}장 — 같은 이름은 ${MAX_COPIES}장까지예요` })
  if (!over.length) checks.push({ ok: true, lead: `같은 이름은 ${MAX_COPIES}장까지 (기본 에너지 제외)` })

  if (known.some(({ card }) => isBasicPokemon(card))) checks.push({ ok: true, lead: '기본 포켓몬 1장 이상' })
  else checks.push({ ok: false, lead: '기본 포켓몬이 없어요' })

  const limitOne = [
    { tag: 'ACE SPEC', label: 'ACE SPEC' },
    { tag: 'Radiant', label: '찬란한 포켓몬' },
  ]
  let limitsOk = true
  for (const { tag, label } of limitOne) {
    const n = known.filter(({ card }) => card.subtypes?.includes(tag)).reduce((s, { count }) => s + count, 0)
    if (n > 1) {
      limitsOk = false
      checks.push({ ok: false, strong: `${label} ${n}장`, rest: ' — 덱에 1장만 넣을 수 있어요' })
    }
  }
  if (limitsOk) checks.push({ ok: true, lead: 'ACE SPEC · 찬란한 포켓몬 각 1장까지' })

  if (format !== 'unlimited') {
    const illegal = known.filter(({ card }) => !isBasicEnergy(card) && !card.formats?.includes(format))
    for (const { card } of illegal) {
      checks.push({ ok: false, strong: `${displayName(card)} (${card.set.name} ${card.number})`, rest: ` — ${FORMATS[format]}에서 쓸 수 없어요` })
    }
    if (!illegal.length) checks.push({ ok: true, lead: `${FORMATS[format]}에서 사용 가능` })
  }
  return checks
}

// --- Pokémon TCG Live text ------------------------------------------------------------------------

export const MAX_IMPORT_LENGTH = 20_000
const MAX_IMPORT_LINES = 200

const setsByCode = new Map<string, string[]>()
const codeBySet = new Map<string, string>()
for (const s of bundledSets as { id: string; code?: string }[]) {
  if (!s.code) continue
  setsByCode.set(s.code.toUpperCase(), [...(setsByCode.get(s.code.toUpperCase()) ?? []), s.id])
  codeBySet.set(s.id, s.code)
}

// "Basic {R} Energy Energy 2" in older exports: the Scarlet & Violet basic Energy cards
const BASIC_ENERGY_BY_SYMBOL: Record<string, string> = {
  G: 'sve-1', R: 'sve-2', W: 'sve-3', L: 'sve-4', P: 'sve-5', F: 'sve-6', D: 'sve-7', M: 'sve-8',
}

// One simple pattern per line, no nested quantifiers: "4 Charizard ex PAF 54"
const LINE = /^(\d{1,3}) (.+) ([A-Za-z0-9-]{2,8}) ([A-Za-z0-9-]{1,8})$/
const HEADER = /^(Pokémon|Pokemon|Trainer|Energy|Total Cards)\s*:\s*\d*$/i

export interface ImportLine {
  line: number
  text: string
  count: number
  name: string
  /** Card ids that may be this line, most likely first */
  candidates: string[]
}

export interface ImportProblem {
  line: number
  text: string
  reason: string
}

/** Splits a pasted deck list into lines we can look up and lines we can't read */
export function parseDeckList(input: string) {
  const lines: ImportLine[] = []
  const problems: ImportProblem[] = []
  if (input.length > MAX_IMPORT_LENGTH) {
    problems.push({ line: 0, text: '', reason: `목록이 너무 길어요 (최대 ${MAX_IMPORT_LENGTH.toLocaleString()}자)` })
    return { lines, problems }
  }
  const rows = input.split(/\r\n|\r|\n/)
  if (rows.length > MAX_IMPORT_LINES) {
    problems.push({ line: 0, text: '', reason: `줄이 너무 많아요 (최대 ${MAX_IMPORT_LINES}줄)` })
    return { lines, problems }
  }
  rows.forEach((row, i) => {
    const text = row.replace(/\s+/g, ' ').trim().replace(/^\* /, '')
    if (!text || HEADER.test(text)) return
    const line = i + 1
    const m = LINE.exec(text)
    if (!m) {
      problems.push({ line, text, reason: '형식이 맞지 않아요 (수량 이름 세트 번호)' })
      return
    }
    const [, rawCount, name, rawCode, rawNumber] = m
    const count = Number(rawCount)
    if (!isCount(count)) {
      problems.push({ line, text, reason: `수량은 1~${MAX_COUNT}장이어야 해요` })
      return
    }
    const symbol = /^Basic \{([A-Z])\} Energy$/.exec(name)?.[1]
    if (symbol && Object.hasOwn(BASIC_ENERGY_BY_SYMBOL, symbol)) {
      lines.push({ line, text, count, name, candidates: [BASIC_ENERGY_BY_SYMBOL[symbol]] })
      return
    }
    const setIds = setsByCode.get(rawCode.toUpperCase())
    if (!setIds) {
      problems.push({ line, text, reason: `세트 코드 ${rawCode}를 찾을 수 없어요` })
      return
    }
    // "054" and "54" are the same number; "TG01" stays as it is
    const number = /^\d+$/.test(rawNumber) ? String(Number(rawNumber)) : rawNumber
    lines.push({ line, text, count, name, candidates: setIds.map((s) => `${s}-${number}`) })
  })
  return { lines, problems }
}

/** The deck as a Pokémon TCG Live list */
export function exportDeckList(cards: DeckCard[], info: Map<string, CardListItem>) {
  const groups: [string, string][] = [
    ['Pokémon', 'Pokémon'],
    ['Trainer', 'Trainer'],
    ['Energy', 'Energy'],
  ]
  const out: string[] = []
  for (const [supertype, title] of groups) {
    const rows = cards.flatMap(({ id, count }) => {
      const c = info.get(id)
      return c && c.supertype === supertype ? [{ c, count }] : []
    })
    if (!rows.length) continue
    out.push(`${title}: ${rows.reduce((n, r) => n + r.count, 0)}`)
    for (const { c, count } of rows) out.push(`${count} ${c.name} ${codeBySet.get(c.set.id) ?? c.set.id.toUpperCase()} ${c.number}`)
    out.push('')
  }
  out.push(`Total Cards: ${deckSize(cards)}`)
  return out.join('\n')
}

// --- Share links ------------------------------------------------------------------------------------

export const MAX_SHARE_QUERY = 4_000

/** /decks/shared?name=…&format=…&cards=id*count,id*count */
export function shareParams(deck: Pick<Deck, 'name' | 'format' | 'cards'>) {
  return new URLSearchParams({
    name: deck.name,
    format: deck.format,
    cards: deck.cards.map((c) => `${c.id}*${c.count}`).join(','),
  })
}

/** A shared deck, or null if the link is broken or tampered with */
export function deckFromShareParams(params: URLSearchParams): Pick<Deck, 'name' | 'format' | 'cards'> | null {
  if (params.toString().length > MAX_SHARE_QUERY) return null
  const format = params.get('format')
  const raw = params.get('cards') ?? ''
  if (!isDeckFormat(format) || !raw) return null
  const entries = raw.split(',').map((part) => {
    const star = part.lastIndexOf('*')
    const count = part.slice(star + 1)
    // Plain digits only: Number() would also accept "1e1", "0x0A" or " 4"
    return { id: part.slice(0, star), count: /^\d{1,2}$/.test(count) ? Number(count) : NaN }
  })
  // Any unreadable entry means the link was cut or edited: refuse it rather than show part of it
  if (entries.some((e) => !ID_PATTERN.test(e.id) || !isCount(e.count))) return null
  const cards = sanitizeCards(entries)
  if (!cards.length) return null
  return { name: cleanDeckName(params.get('name') ?? '') || '공유받은 덱', format, cards }
}

// --- Images ---------------------------------------------------------------------------------------

/** A card's hosted small image from its id alone (deck covers), same naming as server/cardsApi.ts */
export function smallImageUrl(id: string) {
  const setId = id.slice(0, id.lastIndexOf('-'))
  const file = id.replace(/[^\w.-]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}`)
  return `https://yongb15.github.io/pokemon-card-images-sm/${setId}/${file}.webp`
}
