import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Query-string state. `push` adds a history entry (filter/page changes, so the back button
 * works); `replace` doesn't (typing in the search box, URL clean-ups).
 */
export function useUrlParams() {
  const [params, setSearchParams] = useSearchParams()

  // Keep `setParams` stable: effects that call it must not re-run just because the URL changed.
  const setSearchParamsRef = useRef(setSearchParams)
  useEffect(() => {
    setSearchParamsRef.current = setSearchParams
  }, [setSearchParams])

  const setParams = useCallback((next: URLSearchParams, mode: 'push' | 'replace' = 'push') => {
    if (next.toString() === new URLSearchParams(window.location.search).toString()) return
    // Filter changes keep the scroll position; page changes scroll to the results themselves
    setSearchParamsRef.current(next, { replace: mode === 'replace', preventScrollReset: true })
  }, [])

  return [params, setParams] as const
}
