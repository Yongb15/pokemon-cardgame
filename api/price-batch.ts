// Vercel Function for /api/prices/batch (rewritten in vercel.json). Logic: server/prices/top.ts
import { handleBatch } from '../server/prices/top.js'

export function GET(request: Request) {
  return handleBatch(new URL(request.url).searchParams)
}
