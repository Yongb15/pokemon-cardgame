import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Mirrors the /api/tcg rewrite + function on Vercel (without its retries and edge cache)
    proxy: {
      '/api/tcg': {
        target: 'https://api.pokemontcg.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tcg/, '/v2'),
      },
    },
  },
})
