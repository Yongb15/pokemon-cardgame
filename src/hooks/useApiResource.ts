import { useCallback, useEffect, useRef, useState } from 'react'

/** After this long without a response, the UI tells the user the server is slow. */
const SLOW_AFTER_MS = 5_000

interface Settled<T> {
  key: string
  status: 'success' | 'error'
  data?: T
  error?: Error
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/**
 * Loads `load()` whenever `key` changes (null = nothing to load yet), cancelling the previous
 * request. Loading is derived from a key mismatch, so a new key never shows stale data.
 */
export function useApiResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const [slowKey, setSlowKey] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  const fullKey = key === null ? null : `${key}#${reloadToken}`

  useEffect(() => {
    if (fullKey === null) return
    const controller = new AbortController()
    const slowTimer = setTimeout(() => setSlowKey(fullKey), SLOW_AFTER_MS)
    loadRef.current(controller.signal)
      .then((data) => setSettled({ key: fullKey, status: 'success', data }))
      .catch((error: unknown) => {
        if (!isAbort(error)) setSettled({ key: fullKey, status: 'error', error: error as Error })
      })
      .finally(() => clearTimeout(slowTimer))
    return () => {
      controller.abort()
      clearTimeout(slowTimer)
    }
  }, [fullKey])

  const retry = useCallback(() => setReloadToken((n) => n + 1), [])

  const current = settled?.key === fullKey ? settled : null
  const status = fullKey === null ? 'idle' : (current?.status ?? 'loading')
  return {
    status,
    data: current?.data,
    error: current?.error ?? null,
    slow: status === 'loading' && slowKey === fullKey,
    retry,
  } as const
}
