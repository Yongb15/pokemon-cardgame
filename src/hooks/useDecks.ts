import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getCardsBatch } from '../api/cards'
import { loadDecks, subscribeDecks } from '../lib/deck'
import type { CardListItem } from '../types/card'

/** Saved decks (localStorage), kept in sync across components and tabs */
export function useDecks() {
  return useSyncExternalStore(subscribeDecks, loadDecks)
}

// Card details seen so far (from searches and batch lookups), shared by every deck screen
const known = new Map<string, CardListItem>()
// Ids the server doesn't know (a link to a card removed from the data): don't ask again
const unknown = new Set<string>()

export function rememberCards(cards: CardListItem[]) {
  for (const card of cards) known.set(card.id, card)
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Details for the given card ids, fetching the ones we haven't seen in one batch request */
export function useCardInfo(ids: string[]) {
  const idKey = [...new Set(ids)].sort().join(',')
  const missingKey = idKey
    .split(',')
    .filter((id) => id && !known.has(id) && !unknown.has(id))
    .join(',')
  const [loaded, setLoaded] = useState(0)
  const [error, setError] = useState<{ key: string; error: Error } | null>(null)

  useEffect(() => {
    if (!missingKey) return
    const controller = new AbortController()
    const wanted = missingKey.split(',')
    getCardsBatch(wanted, controller.signal)
      .then((cards) => {
        rememberCards(cards)
        for (const id of wanted) if (!known.has(id)) unknown.add(id)
        setLoaded((n) => n + 1)
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setError({ key: missingKey, error: e as Error })
      })
    return () => controller.abort()
  }, [missingKey])

  const info = useMemo(() => {
    void loaded // re-read `known` after a batch arrives
    const map = new Map<string, CardListItem>()
    for (const id of idKey.split(',')) {
      const card = known.get(id)
      if (card) map.set(id, card)
    }
    return map
  }, [idKey, loaded])

  const failed = error?.key === missingKey ? error.error : null
  return {
    info,
    loading: !!missingKey && !failed,
    error: failed,
    /** Ids in the deck that no longer exist in the card data */
    unknownIds: idKey.split(',').filter((id) => unknown.has(id)),
  }
}
