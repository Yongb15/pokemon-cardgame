import { useEffect, useState } from 'react'
import { getCollectionSummary } from '../api/account'
import { useSession } from './useSession'

/**
 * The signed-in user's own copies per card, for building a deck from the collection (docs/deck/simulator.md
 * §1). Fetched once per editor visit and per user; a failure (a 401 after the session ran out included)
 * leaves it null, which hides the collection view, and is not retried (Security D-2). Only the owner's editor
 * uses it: never shared pages, links or exports (D-1).
 */
export function useOwnedCards(): Map<string, number> | null {
  const session = useSession()
  // Keyed by nickname: a different account signing in on this tab gets its own fetch
  const userId = session.status === 'in' ? session.user.nickname : null
  const [owned, setOwned] = useState<{ userId: string; map: Map<string, number> } | null>(null)

  useEffect(() => {
    if (!userId) return
    let live = true
    getCollectionSummary().then(
      (summary) => {
        if (live) setOwned({ userId, map: new Map(summary.owned.map((o) => [o.cardId, o.count])) })
      },
      () => {
        // no collection view this visit
      },
    )
    return () => {
      live = false
    }
  }, [userId])

  return userId && owned?.userId === userId ? owned.map : null
}
