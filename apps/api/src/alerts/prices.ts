// The account API asks our own public price function for current prices (docs/price/alerts.md §2,
// Security Q1): fixed host from config, no redirects, 3 s, 64 KB, JSON only, and only the numbers for
// the ids it asked about survive. Any failure means "no prices this time".

const TIMEOUT_MS = 3000
const MAX_BYTES = 64 * 1024
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export const BATCH_MAX = 50

/** The body, counted while it streams and dropped past 64 KB (Security Info: cap before buffering) */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export type PriceFetch =(ids: string[]) => Promise<Map<string, number> | 'unknown' | null>

/**
 * `ids`: 1–50 card ids. Returns the won headline of each priced one, 'unknown' when the function says
 * an id isn't a card (HTTP 400), or null on any other failure.
 */
export function batchPrices(origin: string, fetchImpl: typeof fetch = fetch): PriceFetch {
  return async (ids) => {
    const sorted = [...new Set(ids)].sort()
    if (!sorted.length || sorted.length > BATCH_MAX) return null
    const url = new URL('/api/prices/batch', origin)
    url.search = `ids=${sorted.map(encodeURIComponent).join(',')}`
    try {
      const res = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'card-dex-api (+https://github.com/Yongb15/pokemon-cardgame)', accept: 'application/json' },
      })
      if (res.status === 400) return 'unknown'
      // A challenge page or anything not JSON is a failure, not data (previews get bot-checked)
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('application/json')) return null
      const text = await readCapped(res)
      if (text === null) return null
      const body = JSON.parse(text) as unknown
      if (!body || typeof body !== 'object') return null
      const { today, prices } = body as { today?: unknown; prices?: unknown }
      if (typeof today !== 'string' || !ISO_DAY.test(today) || !prices || typeof prices !== 'object' || Array.isArray(prices)) return null
      const wanted = new Set(sorted)
      const out = new Map<string, number>()
      for (const [id, krw] of Object.entries(prices)) {
        if (wanted.has(id) && Number.isInteger(krw) && (krw as number) > 0 && (krw as number) <= 100_000_000) out.set(id, krw as number)
      }
      return out
    } catch {
      return null
    }
  }
}
