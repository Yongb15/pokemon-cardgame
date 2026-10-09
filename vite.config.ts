import react from '@vitejs/plugin-react'
import { defaultClientConditions, defaultServerConditions, defineConfig, type Plugin } from 'vite'

/**
 * Serves /api/cards from the dev server with the same code as the Vercel Function
 * (server/cardsApi.ts), so `npm run dev` behaves like the deployed site.
 */
function cardsApi(): Plugin {
  return {
    name: 'cards-api',
    configureServer(server) {
      // Server-side only: the dev API reads DATABASE_URL like the Vercel Function does. (Vite's own
      // env loading only exposes VITE_ variables to the client; nothing here reaches the bundle.)
      try {
        process.loadEnvFile('.env')
      } catch {
        // no .env: the prices API answers 500 locally, everything else works
      }
      // /api/prices/top is its own function on Vercel too (server/prices/top.ts)
      server.middlewares.use('/api/prices/top', async (req, res) => {
        const { handleTop } = (await server.ssrLoadModule('/server/prices/top.ts')) as typeof import('./server/prices/top.js')
        const response = await handleTop(new URL(req.url ?? '/', 'http://localhost').searchParams)
        res.statusCode = response.status
        response.headers.forEach((value: string, key: string) => res.setHeader(key, value))
        res.end(await response.text())
      })
      server.middlewares.use('/api/cards', async (req, res) => {
        // /api/cards/:id/prices is its own function on Vercel (server/prices/api.ts)
        const prices = /^\/([^/?]+)\/prices(?:\?|$)/.exec(req.url ?? '')
        if (prices) {
          const { handlePrices } = (await server.ssrLoadModule('/server/prices/api.ts')) as typeof import('./server/prices/api.js')
          const url = new URL(req.url ?? '/', 'http://localhost')
          const response = await handlePrices(decodeURIComponent(prices[1]), url.searchParams, {
            method: req.method ?? 'GET',
            userAgent: req.headers['user-agent'] ?? null,
            fetchSite: (req.headers['sec-fetch-site'] as string | undefined) ?? null,
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
  // @card-dex/shared: its TypeScript source (the API server runs the built copy, packages/shared/dist)
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
})
