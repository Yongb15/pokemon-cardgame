// The signed-in user's decks (docs/design/deck-sync.webp, docs/auth/design.md §5). Loaded once per
// session and kept here as the screens change them; signed out, the deck screens use the browser's
// decks instead (src/lib/deck.ts) exactly as before.

import { useSyncExternalStore } from 'react'
import {
  AccountApiError,
  createAccountDeck,
  deleteAccountDeck,
  getAccountDeck,
  importDecks,
  listAccountDecks,
  saveAccountDeck,
  type AccountDeck,
  type AccountDeckBody,
  type ImportResult,
} from '../api/account'
import { cleanDeckName, deleteDecks, loadDecks, MAX_DECK_NAME, type Deck } from '../lib/deck'
import { onSessionChange, type Session } from './useSession'

export type AccountDecks =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; decks: Deck[] }

let state: AccountDecks = { status: 'idle' }
let signedIn = false
const listeners = new Set<() => void>()

function set(next: AccountDecks) {
  state = next
  for (const listener of listeners) listener()
}

export const errorMessage = (error: unknown, fallback = '처리하지 못했어요. 잠시 후 다시 시도해 주세요.') =>
  error instanceof AccountApiError ? error.message : fallback

export const toDeck = (d: AccountDeck): Deck => ({
  id: d.id,
  name: d.name,
  format: d.format,
  cards: d.cards,
  updatedAt: Date.parse(d.updatedAt) || 0,
  version: d.version,
  ...(d.coverId && { coverId: d.coverId }),
  ...(d.problems !== null && { problems: d.problems }),
})

export const toBody = (d: Pick<Deck, 'name' | 'format' | 'cards' | 'coverId' | 'problems'>): AccountDeckBody => ({
  name: d.name,
  format: d.format,
  cards: d.cards,
  coverId: d.coverId ?? null,
  problems: d.problems ?? null,
})

/** Puts a deck the server sent back into the list, newest first */
function upsert(deck: Deck) {
  if (state.status !== 'ready') return
  set({ status: 'ready', decks: [deck, ...state.decks.filter((d) => d.id !== deck.id)].sort((a, b) => b.updatedAt - a.updatedAt) })
}

export async function loadAccountDecks() {
  set({ status: 'loading' })
  try {
    const { decks } = await listAccountDecks()
    set({ status: 'ready', decks: decks.map(toDeck) })
  } catch (error) {
    set({ status: 'error', message: errorMessage(error, '덱을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') })
  }
}

/** A new account deck (throws the API's error: 422 at the limit, 401…) */
export async function createInAccount(init: Partial<Pick<Deck, 'name' | 'format' | 'cards'>>) {
  const { deck } = await createAccountDeck(
    toBody({ name: cleanDeckName(init.name ?? '') || '새 덱', format: init.format ?? 'standard', cards: init.cards ?? [] }),
  )
  const created = toDeck(deck)
  upsert(created)
  return created
}

/** Saves over `version`; 'conflict' when another device saved first (409) */
export async function saveInAccount(deck: Deck): Promise<Deck | 'conflict'> {
  try {
    const { deck: saved } = await saveAccountDeck(deck.id, toBody(deck), deck.version ?? 1)
    const next = toDeck(saved)
    upsert(next)
    return next
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 409) return 'conflict'
    throw error
  }
}

/** The server's current copy (after a conflict) */
export async function reloadFromAccount(id: string) {
  const { deck } = await getAccountDeck(id)
  const fresh = toDeck(deck)
  upsert(fresh)
  return fresh
}

export async function removeFromAccount(id: string) {
  await deleteAccountDeck(id)
  if (state.status === 'ready') set({ status: 'ready', decks: state.decks.filter((d) => d.id !== id) })
}

/** "이름 (사본)", cut so the whole stays within 50 characters */
export function copyName(name: string) {
  const suffix = ' (사본)'
  return [...name].slice(0, MAX_DECK_NAME - suffix.length).join('').trimEnd() + suffix
}

/**
 * Moves this browser's decks into the account (qa I-1, I-2): the server skips ones it already has
 * and keeps to the 100-deck limit; whatever it took (or already had) leaves the browser.
 */
export async function importBrowserDecks(): Promise<ImportResult> {
  const local = loadDecks()
  const result = await importDecks(local.map((d) => ({ ...toBody(d), sourceId: d.id, updatedAt: d.updatedAt })))
  try {
    deleteDecks([...result.imported.map((d) => d.sourceId), ...result.duplicates])
  } catch {
    // storage blocked: the decks stay here, and importing again only finds duplicates
  }
  await loadAccountDecks()
  return result
}

/** Follows the session: loads on sign-in, forgets on sign-out */
onSessionChange((session: Session) => {
  if (session.status === 'in' && !signedIn) {
    signedIn = true
    void loadAccountDecks()
  } else if (session.status === 'out' && signedIn) {
    signedIn = false
    set({ status: 'idle' })
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAccountDecks() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
