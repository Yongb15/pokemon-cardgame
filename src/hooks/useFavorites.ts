// The signed-in user's hearted cards (docs/design/favorites.webp). Loaded once per session, newest
// first; a heart flips at once and goes back if the save fails (qa: optimistic toggle). A heart
// pressed while signed out is remembered for the trip through the sign-in page and saved on return.

import { useSyncExternalStore } from 'react'
import { AccountApiError, addFavorite, getFavorites, removeFavorite } from '../api/account'
import { onSessionChange, useSession, type Session } from './useSession'

export type Favorites =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; ids: string[] }

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

export async function loadFavorites() {
  set({ status: 'loading' })
  try {
    const { cards } = await getFavorites()
    set({ status: 'ready', ids: cards })
    const pending = takePendingHeart()
    if (pending && !cards.includes(pending)) await toggleFavorite(pending)
  } catch (error) {
    set({ status: 'error', message: message(error) })
  }
}

/** Adds or removes a heart; resolves to an error message when the save failed (and was undone) */
export async function toggleFavorite(cardId: string): Promise<string | null> {
  if (state.status !== 'ready') return null
  const had = state.ids.includes(cardId)
  set({ status: 'ready', ids: had ? state.ids.filter((id) => id !== cardId) : [cardId, ...state.ids] })
  try {
    await (had ? removeFavorite(cardId) : addFavorite(cardId))
    return null
  } catch (error) {
    // Put it back where it was
    if (state.status === 'ready') {
      const now = state.ids
      set({ status: 'ready', ids: had ? [cardId, ...now.filter((id) => id !== cardId)] : now.filter((id) => id !== cardId) })
    }
    return error instanceof AccountApiError ? error.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
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
