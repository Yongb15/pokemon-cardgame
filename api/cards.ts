// Vercel Functions for /api/cards (this file), /api/cards/:id, /api/cards/:id/neighbors and
// /api/cards/:id/related (api/cards/…). They route from the request path (server/cardsRoute.ts);
// the API itself is server/cardsApi.ts, shared with the Vite dev server.

import { cardsRoute } from '../server/cardsRoute.js'

export const GET = (request: Request) => cardsRoute(request)
// HEAD gets the same headers (cache checks, link previews)
export const HEAD = GET
