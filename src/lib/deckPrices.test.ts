import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDeckPrices } from './deckPrices'

afterEach(() => vi.unstubAllGlobals())

/** A fake /api/prices/batch: prices every id except those starting with "x"; records the requests */
function fakeBatch(calls: string[]) {
  vi.stubGlobal('fetch', async (url: string) => {
    const ids = new URL(url, 'http://x').searchParams.get('ids')!.split(',')
    calls.push(ids.join(','))
    return new Response(JSON.stringify({ today: '2026-10-21', prices: Object.fromEntries(ids.filter((id) => !id.startsWith('x')).map((id) => [id, 1000])) }))
  })
}

describe('deck prices (v1.15.0 §3, Security D-6)', () => {
  it('asks with sorted, unique ids, 50 a request, at most 2 requests, and remembers the answers', async () => {
    const calls: string[] = []
    fakeBatch(calls)
    const ids = Array.from({ length: 120 }, (_, i) => `t${String(i).padStart(3, '0')}`).reverse()
    const prices = await loadDeckPrices([...ids, ids[0]!])
    expect(calls).toHaveLength(2)
    expect(calls[0]!.split(',')).toHaveLength(50)
    expect(calls[0]!.split(',')).toEqual([...calls[0]!.split(',')].sort())
    expect(Object.keys(prices)).toHaveLength(100)
    // Already known: no new request
    await loadDeckPrices(['t000', 't001'])
    expect(calls).toHaveLength(2)
  })

  it('cards without a price are left out, and an error is thrown, not retried', async () => {
    const calls: string[] = []
    fakeBatch(calls)
    expect(await loadDeckPrices(['xa', 'pa'])).toEqual({ pa: 1000 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    await expect(loadDeckPrices(['new-card'])).rejects.toThrow('500')
  })
})
