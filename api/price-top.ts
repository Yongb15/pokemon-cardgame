// Vercel Function for /api/prices/top (rewritten in vercel.json; only that path answers). Logic: server/prices/top.ts
import { atPublicPath } from '../server/prices/publicPath.js'
import { handleTop } from '../server/prices/top.js'

export function GET(request: Request) {
  return atPublicPath(request, '/api/prices/top', (params) => handleTop(params))
}
