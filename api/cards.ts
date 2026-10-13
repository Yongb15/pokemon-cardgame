// Vercel Function for /api/cards and every /api/cards/… path (rewritten here by vercel.json,
// except /api/cards/:id/prices). Routing is server/cardsRoute.ts; the API itself is
// server/cardsApi.ts, shared with the Vite dev server.

import { cardsRoute } from '../server/cardsRoute.js'

export const GET = (request: Request) => cardsRoute(request)
// HEAD gets the same headers (cache checks, link previews)
export const HEAD = GET
