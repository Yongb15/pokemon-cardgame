import { useEffect, useState } from 'react'
import { getRarities, getSets } from '../api/pokemonTcg'
import bundledRarities from '../data/rarities.json'
import bundledSets from '../data/sets.json'
import type { CardSet } from '../types/card'

// Sets and rarities change only when a new expansion comes out. The selects start from a
// snapshot bundled with the app (so they work even while the API is down) and pick up
// newer lists from the API in the background, cached for a day.
const STORAGE_TTL_MS = 24 * 60 * 60_000

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { expires, data } = JSON.parse(raw) as { expires: number; data: T }
    return expires > Date.now() ? data : null
  } catch {
    return null // storage blocked or corrupt: just fetch again
  }
}

function writeStored(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ expires: Date.now() + STORAGE_TTL_MS, data }))
  } catch {
    // storage full or blocked: caching is optional
  }
}

/** One shared in-flight request per list; a failure clears it so a later mount tries again. */
function createLoader<T>(storageKey: string, fetcher: () => Promise<T>) {
  let pending: Promise<T> | null = null
  return () => {
    const stored = readStored<T>(storageKey)
    if (stored) return Promise.resolve(stored)
    pending ??= fetcher().then(
      (data) => {
        writeStored(storageKey, data)
        return data
      },
      (error: unknown) => {
        pending = null
        throw error
      },
    )
    return pending
  }
}

const loadSets = createLoader('card-dex:sets:v1', () => getSets())
const loadRarities = createLoader('card-dex:rarities:v1', () => getRarities())

function useOption<T>(bundled: T[], load: () => Promise<T[]>) {
  const [items, setItems] = useState(bundled)

  useEffect(() => {
    let active = true
    load().then(
      (loaded) => active && loaded.length > 0 && setItems(loaded),
      () => {
        // keep the bundled snapshot; the next page load tries again
      },
    )
    return () => {
      active = false
    }
  }, [load])

  return items
}

/** Options for the set / rarity selects: always available, refreshed from the API when possible. */
export function useFilterOptions() {
  const sets = useOption<CardSet>(bundledSets, loadSets)
  const rarities = useOption<string>(bundledRarities, loadRarities)
  return { sets, rarities }
}
