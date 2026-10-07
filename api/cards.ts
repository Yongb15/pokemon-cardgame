// Vercel Function for /api/cards and /api/cards/* (see the rewrite in vercel.json).
// The routing and data access live in server/cardsApi.ts so the Vite dev server can share them.

import { handleCards } from '../server/cardsApi.js'

export async function GET(request: Request) {
  const url = new URL(request.url)
  // /api/cards/:path* is rewritten to /api/cards?path=:path*
  const rest = url.searchParams.get('path') ?? ''
  url.searchParams.delete('path')
  return handleCards(rest, url.searchParams)
}

// HEAD gets the same headers (cache checks, link previews)
export const HEAD = GET
