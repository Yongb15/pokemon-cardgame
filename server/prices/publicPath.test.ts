import { describe, expect, it } from 'vitest'
import { atPublicPath } from './publicPath.js'

const ok = () => new Response('ok')
const run = (url: string, publicPath: string) => atPublicPath(new Request(`https://example.test${url}`), publicPath, ok)

describe('price functions answer only at their public path (Security I-2b)', () => {
  for (const [name, direct] of [
    ['top', '/api/price-top'],
    ['batch', '/api/price-batch'],
    ['packs', '/api/price-packs'],
  ]) {
    const publicPath = `/api/prices/${name}`
    it(`${publicPath}: 200 there, 404 no-store at ${direct} and look-alikes`, async () => {
      expect((await run(`${publicPath}?a=1`, publicPath)).status).toBe(200)
      for (const url of [direct, `${direct}?a=1`, `${publicPath}/`, `${publicPath}x`, `/api/prices/${name.toUpperCase()}`]) {
        const res = await run(url, publicPath)
        expect(res.status, url).toBe(404)
        expect(res.headers.get('Cache-Control')).toBe('no-store')
      }
    })
  }
})
