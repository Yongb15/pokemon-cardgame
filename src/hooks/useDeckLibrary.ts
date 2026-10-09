// Which decks the deck screens show: the account's when signed in, the browser's when signed out
// (or when the sign-in check failed: the browser's decks are still there to use). While the check
// runs nothing is shown yet, so the browser's decks never flash before the account's (qa).

import { createDeck, deleteDeck, type Deck } from '../lib/deck'
import { createInAccount, removeFromAccount, useAccountDecks } from './useAccountDecks'
import { useDecks } from './useDecks'
import { useSession } from './useSession'

export type DeckLibrary =
  | { mode: 'checking' }
  | { mode: 'local'; decks: Deck[]; sessionError: boolean }
  | { mode: 'account'; status: 'loading' }
  | { mode: 'account'; status: 'error'; message: string }
  | { mode: 'account'; status: 'ready'; decks: Deck[] }

export function useDeckLibrary(): DeckLibrary {
  const session = useSession()
  const local = useDecks()
  const account = useAccountDecks()
  if (session.status === 'unknown') return { mode: 'checking' }
  if (session.status !== 'in') return { mode: 'local', decks: local, sessionError: session.status === 'error' }
  if (account.status === 'ready') return { mode: 'account', status: 'ready', decks: account.decks }
  if (account.status === 'error') return { mode: 'account', status: 'error', message: account.message }
  return { mode: 'account', status: 'loading' }
}

/** A new deck where the library keeps its decks (throws on failure, with the reason to show) */
export async function createInLibrary(mode: 'local' | 'account', init: Partial<Pick<Deck, 'name' | 'format' | 'cards'>>) {
  return mode === 'account' ? createInAccount(init) : createDeck(init)
}

export async function removeFromLibrary(mode: 'local' | 'account', id: string) {
  if (mode === 'account') await removeFromAccount(id)
  else deleteDeck(id)
}
