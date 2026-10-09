// The signed-in user's hearted cards (docs/design/favorites.webp). Loaded once per session, newest
// first; a heart flips at once and goes back if the save fails (qa: optimistic toggle). A heart
// pressed while signed out is remembered for the trip through the sign-in page and saved on return.

import { useSyncExternalStore } from 'react'
import { AccountApiError, addFavorite, getFavorites, removeFavorite } from '../api/account'
import { onSessionChange, useSession, type Session } from './useSession'

export type Favorites =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      ids: string[]
      /** The heart pressed before signing in, saved (error null) or not, for its button to say (qa H-3) */
      auto?: { cardId: string; error: string | null }
    }

let state: Favorites = { status: 'idle' }
let signedIn = false
const listeners = new Set<() => void>()

function set(next: Favorites) {
  state = next
  for (const listener of listeners) listener()
}

const PENDING_KEY = 'card-dex:pending-heart'
const CARD_ID = /^[\w.!?-]{1,40}$/

/** Remember a heart pressed while signed out (this tab only) */
export function rememberHeart(cardId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, cardId)
  } catch {
    // storage blocked: the user presses it again after signing in
  }
}

function takePendingHeart() {
  try {
    const id = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return id && CARD_ID.test(id) ? id : null
  } catch {
    return null
  }
}

const message = (error: unknown) =>
  error instanceof AccountApiError ? error.message : '관심 카드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'

/** What the server last confirmed per card (only cards touched since loading; the rest: `loaded`) */
let loaded = new Set<string>()
const confirmed = new Map<string, boolean>()
const desired = new Map<string, boolean>()
const inflight = new Set<string>()

const serverHas = (cardId: string) => confirmed.get(cardId) ?? loaded.has(cardId)

function show(cardId: string, on: boolean) {
  if (state.status !== 'ready') return
  const rest = state.ids.filter((id) => id !== cardId)
  set({ ...state, ids: on ? [cardId, ...rest] : rest })
}

export async function loadFavorites() {
  set({ status: 'loading' })
  try {
    const { cards } = await getFavorites()
    loaded = new Set(cards)
    confirmed.clear()
    desired.clear()
    set({ status: 'ready', ids: cards })
    // A heart pressed before signing in: save it now and say so either way (qa H-3)
    const pending = takePendingHeart()
    if (pending && !cards.includes(pending)) {
      const failed = await toggleFavorite(pending)
      if (state.status === 'ready') set({ ...state, auto: { cardId: pending, error: failed } })
    }
  } catch (error) {
    set({ status: 'error', message: message(error) })
  }
}

/**
 * Adds or removes a heart. The heart flips at once; requests for one card go one at a time, and
 * after each the latest wish is sent again if it changed meanwhile, so quick repeated presses end
 * where the last press left them (qa H-1). Resolves to an error message when a save failed: the
 * heart then goes back to what the server has.
 */
export async function toggleFavorite(cardId: string): Promise<string | null> {
  if (state.status !== 'ready') return null
  const want = !state.ids.includes(cardId)
  desired.set(cardId, want)
  show(cardId, want)
  if (inflight.has(cardId)) return null // the running loop picks up the new wish
  inflight.add(cardId)
  try {
    for (;;) {
      const target = desired.get(cardId)!
      if (target === serverHas(cardId)) return null
      await (target ? addFavorite(cardId) : removeFavorite(cardId))
      confirmed.set(cardId, target)
    }
  } catch (error) {
    const has = serverHas(cardId)
    desired.set(cardId, has)
    show(cardId, has)
    return error instanceof AccountApiError ? error.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally {
    inflight.delete(cardId)
  }
}

/** Follows the session: loads on sign-in, forgets on sign-out */
onSessionChange((session: Session) => {
  if (session.status === 'in' && !signedIn) {
    signedIn = true
    void loadFavorites()
  } else if (session.status === 'out' && signedIn) {
    signedIn = false
    set({ status: 'idle' })
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFavorites() {
  useSession() // starts the session check if nothing else has
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
