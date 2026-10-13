// Vercel Function for /api/prices/packs (rewritten in vercel.json; only that path answers). Takes no
// parameters at all, so every request is the one cached URL (Security V-1). Logic: server/prices/top.ts
import { atPublicPath } from '../server/prices/publicPath.js'
import { handlePacks } from '../server/prices/top.js'

export function GET(request: Request) {
  return atPublicPath(request, '/api/prices/packs', (params) => handlePacks(params))
}
