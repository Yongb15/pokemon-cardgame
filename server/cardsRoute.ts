// The Vercel Function api/cards.ts serves /api/cards and, through the rewrite
// "/api/cards/(.+)" → "/api/cards" in vercel.json, every /api/cards/… path. The rewrite uses an
// unnamed group on purpose: Vercel adds named rewrite parameters to the query (overwriting a
// client's value of the same name), so routing from one would let clients forge or vary it
// (Security C-1). The request keeps its original path, so routing reads url.pathname instead,
// and any query parameter is the client's own, checked by handleCards.
import { handleCards } from './cardsApi.js'

const PREFIX = '/api/cards'

export function cardsRoute(request: Request) {
  const url = new URL(request.url)
  const rest = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : ''
  return handleCards(rest, url.searchParams)
}
