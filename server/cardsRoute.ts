// Shared by the Vercel Functions under api/cards*: route from the real path, never from a query
// parameter a client could also send (Security C-1).
import { handleCards } from './cardsApi.js'

const PREFIX = '/api/cards'
const bad = () =>
  new Response(JSON.stringify({ error: { message: '알 수 없거나 중복된 파라미터가 있습니다.', code: 400 } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/**
 * `injected`: the path parameter Vercel adds to the query of a `[name].ts` function (e.g. cardId).
 * It must be there exactly once (a client sending the same key makes two, which is refused) and
 * is removed; everything left is checked by handleCards like any other parameter.
 */
export function cardsRoute(request: Request, injected?: string) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(PREFIX)) return bad()
  const params = url.searchParams
  if (injected) {
    if (params.getAll(injected).length !== 1) return bad()
    params.delete(injected)
  }
  return handleCards(url.pathname.slice(PREFIX.length), params)
}
