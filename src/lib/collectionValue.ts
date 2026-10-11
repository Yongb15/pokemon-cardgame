// "My collection's value" (docs/design/collection-value.webp): the owned copies times each card's
// headline price in won from /api/prices/packs. Reference only: real-card prices, not points.

export interface ValuedCard {
  cardId: string
  count: number
  krw: number
}

export interface CollectionValue {
  total: number
  /** Distinct cards with a price, and without one */
  priced: number
  unpriced: number
  /** The priciest cards per copy, most first (ties by id) */
  top: ValuedCard[]
}

export const wonKrw = (krw: number) => `₩${krw.toLocaleString('ko-KR')}`

export function collectionValue(owned: { cardId: string; count: number }[], prices: Record<string, number>, topN = 5): CollectionValue {
  const valued: ValuedCard[] = []
  let unpriced = 0
  for (const { cardId, count } of owned) {
    const krw = Object.hasOwn(prices, cardId) ? prices[cardId] : undefined
    if (typeof krw === 'number' && Number.isFinite(krw) && count > 0) valued.push({ cardId, count, krw })
    else if (count > 0) unpriced++
  }
  return {
    total: valued.reduce((n, v) => n + v.krw * v.count, 0),
    priced: valued.length,
    unpriced,
    top: [...valued].sort((a, b) => b.krw - a.krw || a.cardId.localeCompare(b.cardId)).slice(0, topN),
  }
}

let packPrices: Promise<Record<string, number>> | null = null

/** One shared, edge-cached answer for every user; fetched once per page load */
export function loadPackPrices(): Promise<Record<string, number>> {
  packPrices ??= fetch('/api/prices/packs')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{ prices: Record<string, number> }>
    })
    .then((body) => body.prices)
    .catch((error: unknown) => {
      packPrices = null // the next visit tries again
      throw error
    })
  return packPrices
}
