import { describe, expect, it } from 'vitest'
import { cardsRoute } from './cardsRoute.js'

const ORIGIN = 'https://example.test'
// What Vercel hands an api/cards/[cardId]… function: the real path, plus `cardId` in the query
const vercel = (path: string, query = '') => {
  const id = path.split('/')[3]
  const qs = new URLSearchParams(query)
  if (id) qs.append('cardId', id)
  return new Request(`${ORIGIN}${path}${qs.size ? `?${qs}` : ''}`)
}
const status = async (request: Request, injected?: string) => (await cardsRoute(request, injected)).status

describe('card API routing from the path (Security C-1)', () => {
  it('serves every route from its real path', async () => {
    expect(await status(new Request(`${ORIGIN}/api/cards?sort=newest&page=1&pageSize=24`))).toBe(200)
    expect(await status(vercel('/api/cards/sv1-1'), 'cardId')).toBe(200)
    expect(await status(vercel('/api/cards/batch', 'ids=sv1-1,sv1-2'), 'cardId')).toBe(200)
    expect(await status(vercel('/api/cards/sv1-1/neighbors'), 'cardId')).toBe(200)
    expect(await status(vercel('/api/cards/sv1-1/related', 'limit=6'), 'cardId')).toBe(200)
  })

  it('refuses a client-sent path parameter, on the list and on a card', async () => {
    expect(await status(new Request(`${ORIGIN}/api/cards?path=zq20158`))).toBe(400)
    expect(await status(new Request(`${ORIGIN}/api/cards?path=sv4pt5-54`))).toBe(400)
    expect(await status(vercel('/api/cards/sv4pt5-54', 'path=zz18211'), 'cardId')).toBe(400)
  })

  it('refuses the injected key sent again by the client (it would appear twice)', async () => {
    expect(await status(vercel('/api/cards/sv1-1', 'cardId=sv1-1'), 'cardId')).toBe(400)
    expect(await status(vercel('/api/cards/sv1-1', 'cardId=other'), 'cardId')).toBe(400)
  })

  it('answers 400 with no-store', async () => {
    const res = await cardsRoute(new Request(`${ORIGIN}/api/cards?path=x`))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
