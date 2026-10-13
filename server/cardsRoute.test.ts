import { describe, expect, it } from 'vitest'
import { cardsRoute } from './cardsRoute.js'

const ORIGIN = 'https://example.test'
// Behind the "/api/cards/(.+)" rewrite the request keeps its original path and only the client's
// own query parameters (an unnamed group adds none)
const status = async (pathAndQuery: string) => (await cardsRoute(new Request(ORIGIN + pathAndQuery))).status

describe('card API routing from the path (Security C-1)', () => {
  it('serves every route from its real path', async () => {
    expect(await status('/api/cards?sort=newest&page=1&pageSize=24')).toBe(200)
    expect(await status('/api/cards/sv1-1')).toBe(200)
    expect(await status('/api/cards/ex10-%3F')).toBe(200)
    expect(await status('/api/cards/batch?ids=sv1-1,sv1-2')).toBe(200)
    expect(await status('/api/cards/sv1-1/neighbors')).toBe(200)
    expect(await status('/api/cards/sv1-1/related?limit=6')).toBe(200)
  })

  it('treats path, cardId and id like any unknown parameter (400 no-store)', async () => {
    for (const url of [
      '/api/cards?path=zq20158',
      '/api/cards?path=sv4pt5-54',
      '/api/cards?path=',
      '/api/cards/sv4pt5-54?path=zz18211',
      '/api/cards/sv1-1?cardId=sv1-1',
      '/api/cards/sv1-1/related?limit=6&id=x',
    ]) {
      const res = await cardsRoute(new Request(ORIGIN + url))
      expect(res.status, url).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})
