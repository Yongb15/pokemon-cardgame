// Deck cost (docs/release/v1.15.0-design.md §3): each card's headline in won from /api/prices/batch, the same
// numbers as price alerts. Sorted, unique, at most 50 ids a request and at most 2 requests a view (a deck
// has at most 60 cards: Security D-6). Prices already fetched in this tab are reused.

const BATCH = 50
const MAX_CHUNKS = 2
/** Card id → won, or null when the card has no recent price */
const known = new Map<string, number | null>()

/** Ids the caller has checked against our card data; returns every id it now knows a price (or none) for */
export async function loadDeckPrices(ids: string[], signal?: AbortSignal): Promise<Record<string, number>> {
  const wanted = [...new Set(ids)].sort()
  const missing = wanted.filter((id) => !known.has(id)).slice(0, BATCH * MAX_CHUNKS)
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH)
    const res = await fetch(`/api/prices/batch?${new URLSearchParams({ ids: chunk.join(',') })}`, { signal })
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as { prices?: Record<string, unknown> }
    for (const id of chunk) {
      const krw = body.prices && Object.hasOwn(body.prices, id) ? body.prices[id] : undefined
      known.set(id, typeof krw === 'number' && Number.isFinite(krw) && krw > 0 ? krw : null)
    }
  }
  const out: Record<string, number> = {}
  for (const id of wanted) {
    const krw = known.get(id)
    if (krw != null) out[id] = krw
  }
  return out
}
