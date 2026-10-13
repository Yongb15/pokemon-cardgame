// Vercel Function for /api/cards/:id/prices (rewritten here by "/api/cards/([^/]+)/prices" in
// vercel.json: an unnamed group, so Vercel adds no `id` to the query that a client could also send
// or vary — Security C-1). The id comes from the original path, which the request keeps; a direct
// /api/prices is not a card. The logic lives in server/prices/api.ts so the Vite dev server can share it.

import { waitUntil } from '@vercel/functions'
import { handlePrices } from '../server/prices/api.js'

export function GET(request: Request) {
  const url = new URL(request.url)
  const match = /^\/api\/cards\/([^/]+)\/prices$/.exec(url.pathname)
  let id = ''
  try {
    id = match ? decodeURIComponent(match[1]) : ''
  } catch {
    // malformed escape: not a card id
  }
  return handlePrices(id, url.searchParams, {
    method: request.method,
    userAgent: request.headers.get('user-agent'),
    fetchSite: request.headers.get('sec-fetch-site'),
    waitUntil,
  })
}
