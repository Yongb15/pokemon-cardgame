import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App.tsx'
import { prefetchSearchCards } from './api/cards.ts'
import { filtersFromParams, PAGE_SIZE, pageFromParams, toSearchParams } from './lib/cardFilters.ts'
import CardListPage from './pages/CardListPage.tsx'

// Only the list (the usual landing page) is in the main bundle. Every other page is its own
// chunk, loaded when it is first visited; React Router waits for it before switching pages, so
// nothing flashes in between.
type PageModule = Record<string, React.ComponentType>
const page = (load: () => Promise<PageModule>, name = 'default') => ({
  lazy: async () => ({ Component: (await load())[name] }),
})
const detailPage = () => import('./pages/CardDetailPage.tsx')

// The list is the usual landing page: ask for its first page now rather than after React has
// rendered, so the cards (and their images) show up sooner
if (window.location.pathname === '/') {
  const params = new URLSearchParams(window.location.search)
  // Phones ("load more") always start from page 1, like CardListPage
  const page = window.matchMedia('(max-width: 640px)').matches ? 1 : pageFromParams(params)
  prefetchSearchCards({ ...toSearchParams(filtersFromParams(params)), page, pageSize: PAGE_SIZE })
}

const router = createBrowserRouter([
  {
    element: <App />,
    // First load of a page chunk: nothing yet (the page appears whole, so nothing shifts)
    HydrateFallback: () => null,
    children: [
      { index: true, element: <CardListPage /> },
      { path: 'cards/:id', ...page(detailPage) },
      { path: 'prices', ...page(() => import('./pages/PricesPage.tsx')) },
      { path: 'decks', ...page(() => import('./pages/DeckListPage.tsx')) },
      { path: 'decks/shared', ...page(() => import('./pages/SharedDeckPage.tsx')) },
      { path: 'decks/:deckId', ...page(() => import('./pages/DeckEditorPage.tsx')) },
      { path: 'login', ...page(() => import('./pages/LoginPage.tsx')) },
      { path: 'me', ...page(() => import('./pages/MyPage.tsx')) },
      { path: 'favorites', ...page(() => import('./pages/FavoritesPage.tsx')) },
      { path: 'packs', ...page(() => import('./pages/PacksPage.tsx')) },
      { path: 'collection', ...page(() => import('./pages/CollectionPage.tsx')) },
      { path: 'market', ...page(() => import('./pages/MarketPage.tsx')) },
      { path: 'auctions/:id', ...page(() => import('./pages/AuctionPage.tsx')) },
      { path: 'notifications', ...page(() => import('./pages/NotificationsPage.tsx')) },
      { path: 'admin', ...page(() => import('./pages/AdminPage.tsx'), 'AdminReportsPage') },
      { path: 'admin/auctions/:id', ...page(() => import('./pages/AdminPage.tsx'), 'AdminAuctionPage') },
      { path: 'privacy', ...page(() => import('./pages/PolicyPages.tsx'), 'PrivacyPage') },
      { path: 'terms', ...page(() => import('./pages/PolicyPages.tsx'), 'TermsPage') },
      { path: '*', ...page(() => import('./pages/NotFoundPage.tsx')) },
    ],
  },
])

// Most visits go list → card: fetch the card page's chunk while the browser is idle
const whenIdle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500))
whenIdle(() => void detailPage())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
