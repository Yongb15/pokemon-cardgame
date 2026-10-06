import { useEffect, useState } from 'react'
import { getRarities, getSets } from '../api/pokemonTcg'
import type { CardSet } from '../types/card'

// Sets and rarities change only when a new expansion comes out, so keep them for a day.
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

/** One shared in-flight request per list; a failure clears it so the next mount can retry. */
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

function useOption<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    load().then(
      (loaded) => active && setItems(loaded),
      () => active && setFailed(true),
    )
    return () => {
      active = false
    }
  }, [load])

  return [items, failed] as const
}

/** Options for the set / rarity selects. Empty lists until loaded (or if loading failed). */
export function useFilterOptions() {
  const [sets, setsFailed] = useOption<CardSet>(loadSets)
  const [rarities, raritiesFailed] = useOption<string>(loadRarities)
  return { sets, rarities, setsFailed, raritiesFailed }
}
