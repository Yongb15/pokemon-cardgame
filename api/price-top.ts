// Vercel Function for /api/prices/top (rewritten in vercel.json). Logic: server/prices/top.ts
import { handleTop } from '../server/prices/top.js'

export function GET(request: Request) {
  return handleTop(new URL(request.url).searchParams)
}
