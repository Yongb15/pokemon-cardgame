import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App.tsx'
import { prefetchSearchCards } from './api/cards.ts'
import { filtersFromParams, PAGE_SIZE, pageFromParams, toSearchParams } from './lib/cardFilters.ts'
import CardDetailPage from './pages/CardDetailPage.tsx'
import CardListPage from './pages/CardListPage.tsx'

// The list and the card page are in the main bundle: they are where visits land (home, shared
// links, search engines), and a separate chunk would only start downloading after this one.
// Every other page is its own chunk, loaded on first visit; React Router waits for it before
// switching pages, so nothing flashes in between.
type PageModule = Record<string, React.ComponentType>
const lazyPage = (load: () => Promise<PageModule>, name = 'default') => ({
  lazy: async () => ({ Component: (await load())[name] }),
})

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
      { path: 'cards/:id', element: <CardDetailPage /> },
      { path: 'prices', ...lazyPage(() => import('./pages/PricesPage.tsx')) },
      { path: 'decks', ...lazyPage(() => import('./pages/DeckListPage.tsx')) },
      { path: 'decks/shared', ...lazyPage(() => import('./pages/SharedDeckPage.tsx')) },
      { path: 'decks/:deckId', ...lazyPage(() => import('./pages/DeckEditorPage.tsx')) },
      { path: 'login', ...lazyPage(() => import('./pages/LoginPage.tsx')) },
      { path: 'me', ...lazyPage(() => import('./pages/MyPage.tsx')) },
      { path: 'favorites', ...lazyPage(() => import('./pages/FavoritesPage.tsx')) },
      { path: 'packs', ...lazyPage(() => import('./pages/PacksPage.tsx')) },
      { path: 'collection', ...lazyPage(() => import('./pages/CollectionPage.tsx')) },
      { path: 'market', ...lazyPage(() => import('./pages/MarketPage.tsx')) },
      { path: 'auctions/:id', ...lazyPage(() => import('./pages/AuctionPage.tsx')) },
      { path: 'notifications', ...lazyPage(() => import('./pages/NotificationsPage.tsx')) },
      { path: 'admin', ...lazyPage(() => import('./pages/AdminPage.tsx'), 'AdminReportsPage') },
      { path: 'admin/auctions/:id', ...lazyPage(() => import('./pages/AdminPage.tsx'), 'AdminAuctionPage') },
      { path: 'privacy', ...lazyPage(() => import('./pages/PolicyPages.tsx'), 'PrivacyPage') },
      { path: 'terms', ...lazyPage(() => import('./pages/PolicyPages.tsx'), 'TermsPage') },
      { path: '*', ...lazyPage(() => import('./pages/NotFoundPage.tsx')) },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
