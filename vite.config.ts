import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serves /api/cards from the dev server with the same code as the Vercel Function
 * (server/cardsApi.ts), so `npm run dev` behaves like the deployed site.
 */
function cardsApi(): Plugin {
  return {
    name: 'cards-api',
    configureServer(server) {
      server.middlewares.use('/api/cards', async (req, res) => {
        // /api/cards/:id/prices is its own function on Vercel (server/prices/api.ts)
        const prices = /^\/([^/?]+)\/prices(?:\?|$)/.exec(req.url ?? '')
        if (prices) {
          const { handlePrices } = (await server.ssrLoadModule('/server/prices/api.ts')) as typeof import('./server/prices/api.js')
          const url = new URL(req.url ?? '/', 'http://localhost')
          const response = await handlePrices(decodeURIComponent(prices[1]), url.searchParams, {
            method: req.method ?? 'GET',
            userAgent: req.headers['user-agent'] ?? null,
          })
          res.statusCode = response.status
          response.headers.forEach((value: string, key: string) => res.setHeader(key, value))
          res.end(await response.text())
          return
        }
        const { handleCards } = (await server.ssrLoadModule('/server/cardsApi.ts')) as typeof import('./server/cardsApi.js')
        const url = new URL(req.url ?? '/', 'http://localhost')
        const response = await handleCards(url.pathname, url.searchParams)
        res.statusCode = response.status
        response.headers.forEach((value: string, key: string) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cardsApi()],
})
