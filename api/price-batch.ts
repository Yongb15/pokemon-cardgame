// Vercel Function for /api/prices/batch (rewritten in vercel.json; only that path answers). Logic: server/prices/top.ts
import { atPublicPath } from '../server/prices/publicPath.js'
import { handleBatch } from '../server/prices/top.js'

export function GET(request: Request) {
  return atPublicPath(request, '/api/prices/batch', (params) => handleBatch(params))
}
