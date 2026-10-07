import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { peekSearchCards, searchCards } from '../api/cards'
import { PAGE_SIZE, toSearchParams, type CardFilters } from '../lib/cardFilters'
import type { CardListItem } from '../types/card'

/** After this long without a response, the UI tells the user the server is slow. */
const SLOW_AFTER_MS = 5_000

interface Result {
  /** Which request this result belongs to; a mismatch with the current key means "loading" */
  key: string
  status: 'success' | 'error'
  cards: CardListItem[]
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
 */
export function useCardSearch(filters: CardFilters, page: number, mode: 'paged' | 'append') {
  const [result, setResult] = useState<Result | null>(null)
  const [slowKey, setSlowKey] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const loadMoreController = useRef<AbortController | null>(null)

  // Serialized so effects and memos re-run on content changes, not on new object identities
  const query = JSON.stringify(toSearchParams(filters))
  const key = JSON.stringify([query, page, mode, reloadToken])
  // Per history entry: going back to this list restores the stack, choosing the same filters
  // again (a new entry) starts from page 1
  const { key: entryKey } = useLocation()
  const stackKey = `card-dex:stack:${entryKey}:${query}`

  /**
   * Phones stack pages with "load more". Coming back from a card's detail page, rebuild the
   * same stack from cached pages so the list (and scroll position) is where the user left it.
   */
  const restoreStack = useCallback((): Omit<Result, 'key' | 'status' | 'error' | 'loadingMore' | 'loadMoreError'> | null => {
    if (mode !== 'append' || page !== 1) return null
    let lastPage = 0
    try {
      lastPage = Number(sessionStorage.getItem(stackKey))
    } catch {
      return null // storage blocked
    }
    if (!(lastPage > 1)) return null
    const pages = Array.from({ length: lastPage }, (_, i) =>
      peekSearchCards({ ...JSON.parse(query), page: i + 1, pageSize: PAGE_SIZE }),
    )
    if (pages.some((p) => !p)) return null
    return { cards: pages.flatMap((p) => p!.data), totalCount: pages.at(-1)!.totalCount, lastPage }
  }, [mode, page, query, stackKey])

  useEffect(() => {
    const controller = new AbortController()
    loadMoreController.current?.abort()
    const slowTimer = setTimeout(() => setSlowKey(key), SLOW_AFTER_MS)
    const base = { key, lastPage: page, loadingMore: false, loadMoreError: null }

    searchCards({ ...JSON.parse(query), page, pageSize: PAGE_SIZE }, controller.signal)
      .then((res) => {
        const stack = restoreStack()
        setResult(
          stack
            ? { ...base, ...stack, status: 'success', error: null }
            : { ...base, status: 'success', cards: res.data, totalCount: res.totalCount, error: null },
        )
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
  }, [key, query, page, restoreStack])

  // A page seen recently (e.g. coming back from a card's detail page) renders on the first paint,
  // so scroll restoration has the full grid to land on instead of a skeleton.
  const current = useMemo<Result | null>(() => {
    if (result?.key === key) return result
    const stack = restoreStack()
    if (stack) return { key, ...stack, status: 'success', error: null, loadingMore: false, loadMoreError: null }
    const cached = peekSearchCards({ ...JSON.parse(query), page, pageSize: PAGE_SIZE })
    if (!cached) return null
    return {
      key,
      status: 'success',
      cards: cached.data,
      totalCount: cached.totalCount,
      lastPage: page,
      error: null,
      loadingMore: false,
      loadMoreError: null,
    }
  }, [result, key, query, page, restoreStack])
  const status = current?.status ?? 'loading'

  const retry = useCallback(() => setReloadToken((n) => n + 1), [])

  const loadMore = useCallback(() => {
    if (!current || current.status !== 'success' || current.loadingMore) return
    const nextPage = current.lastPage + 1
    const controller = new AbortController()
    loadMoreController.current = controller
    const update = (patch: Partial<Result>) =>
      setResult((prev) => (prev?.key === key ? { ...prev, ...patch } : prev))
    update({ loadingMore: true, loadMoreError: null })

    searchCards({ ...JSON.parse(query), page: nextPage, pageSize: PAGE_SIZE }, controller.signal)
      .then((res) => {
        try {
          sessionStorage.setItem(stackKey, String(nextPage))
        } catch {
          // storage blocked: the stack just won't survive a trip to a detail page
        }
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
  }, [current, key, query, stackKey])

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
