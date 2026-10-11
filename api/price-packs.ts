// Vercel Function for /api/prices/packs (rewritten in vercel.json). Takes no parameters at all, so
// every request is the one cached URL (Security V-1). Logic: server/prices/top.ts
import { handlePacks } from '../server/prices/top.js'

export function GET(request: Request) {
  return handlePacks(new URL(request.url).searchParams)
}
