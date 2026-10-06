import { useCallback, useMemo, useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

const getSearch = () => window.location.search

/**
 * Query-string state without a router. `push` adds a history entry (filter/page changes,
 * so the back button works); `replace` doesn't (typing in the search box).
 */
export function useUrlParams() {
  const search = useSyncExternalStore(subscribe, getSearch)

  const setParams = useCallback((params: URLSearchParams, mode: 'push' | 'replace' = 'push') => {
    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url)
    // pushState/replaceState don't fire popstate; notify subscribers ourselves
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  const params = useMemo(() => new URLSearchParams(search), [search])
  return [params, setParams] as const
}
