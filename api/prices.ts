// Vercel Function for /api/cards/:id/prices (rewritten to /api/prices?id=:id in vercel.json).
// The logic lives in server/prices/api.ts so the Vite dev server can share it.

import { waitUntil } from '@vercel/functions'
import { handlePrices } from '../server/prices/api.js'

export function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  url.searchParams.delete('id')
  return handlePrices(id, url.searchParams, {
    method: request.method,
    userAgent: request.headers.get('user-agent'),
    waitUntil,
  })
}
