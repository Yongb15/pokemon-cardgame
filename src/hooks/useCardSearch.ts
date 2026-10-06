import { useCallback, useEffect, useRef, useState } from 'react'
import { searchCards } from '../api/pokemonTcg'
import { PAGE_SIZE, SORT_OPTIONS, toLuceneQuery, type CardFilters } from '../lib/cardFilters'
import type { Card } from '../types/card'

/** After this long without a response, the UI tells the user the server is slow. */
const SLOW_AFTER_MS = 5_000

interface Result {
  /** Which request this result belongs to; a mismatch with the current key means "loading" */
  key: string
  status: 'success' | 'error'
  cards: Card[]
  totalCount: number
  /** Last page included in `cards` (greater than the requested page after "load more") */
  lastPage: number
  error: Error | null
  loadingMore: boolean
  loadMoreError: Error | null
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/**
 * Cards for the current filters and page. `mode` separates desktop pagination from mobile
 * "load more", so switching between them starts from a fresh result instead of a stale stack.
 * Status is 'invalid' (no request sent) when the search term can't be searched, e.g. Korean.
 */
export function useCardSearch(filters: CardFilters, page: number, mode: 'paged' | 'append') {
  const [result, setResult] = useState<Result | null>(null)
  const [slowKey, setSlowKey] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const loadMoreController = useRef<AbortController | null>(null)

  const q = toLuceneQuery(filters)
  const orderBy = SORT_OPTIONS[filters.sort].orderBy
  const key = JSON.stringify([q, orderBy, page, mode, reloadToken])

  useEffect(() => {
    if (q === null) return
    const controller = new AbortController()
    loadMoreController.current?.abort()
    const slowTimer = setTimeout(() => setSlowKey(key), SLOW_AFTER_MS)
    const base = { key, lastPage: page, loadingMore: false, loadMoreError: null }

    searchCards({ q, orderBy, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((res) => {
        setResult({ ...base, status: 'success', cards: res.data, totalCount: res.totalCount, error: null })
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setResult({ ...base, status: 'error', cards: [], totalCount: 0, error: error as Error })
      })
      .finally(() => clearTimeout(slowTimer))

    return () => {
      controller.abort()
      clearTimeout(slowTimer)
    }
  }, [key, q, orderBy, page])

  const current = result?.key === key ? result : null
  const status = q === null ? 'invalid' : (current?.status ?? 'loading')

  const retry = useCallback(() => setReloadToken((n) => n + 1), [])

  const loadMore = useCallback(() => {
    if (!current || current.status !== 'success' || current.loadingMore) return
    const nextPage = current.lastPage + 1
    const controller = new AbortController()
    loadMoreController.current = controller
    const update = (patch: Partial<Result>) =>
      setResult((prev) => (prev?.key === key ? { ...prev, ...patch } : prev))
    update({ loadingMore: true, loadMoreError: null })

    searchCards({ q: q ?? '', orderBy, page: nextPage, pageSize: PAGE_SIZE }, controller.signal)
      .then((res) => {
        setResult((prev) =>
          prev?.key === key
            ? {
                ...prev,
                cards: [...prev.cards, ...res.data],
                totalCount: res.totalCount,
                lastPage: nextPage,
                loadingMore: false,
              }
            : prev,
        )
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        update({ loadingMore: false, loadMoreError: error as Error })
      })
  }, [current, key, q, orderBy])

  useEffect(() => () => loadMoreController.current?.abort(), [])

  // While a new request is loading, keep the previous total so the count doesn't flash to 0
  const totalCount = current?.totalCount ?? result?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return {
    status,
    cards: current?.cards ?? [],
    totalCount,
    totalPages,
    error: current?.error ?? null,
    slow: status === 'loading' && slowKey === key,
    hasMore: status === 'success' && current!.lastPage < totalPages,
    loadingMore: current?.loadingMore ?? false,
    loadMoreError: current?.loadMoreError ?? null,
    retry,
    loadMore,
  }
}
