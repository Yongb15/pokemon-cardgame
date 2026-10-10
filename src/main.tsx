import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App.tsx'
import { prefetchSearchCards } from './api/cards.ts'
import { filtersFromParams, PAGE_SIZE, pageFromParams, toSearchParams } from './lib/cardFilters.ts'
import CardDetailPage from './pages/CardDetailPage.tsx'
import CardListPage from './pages/CardListPage.tsx'
import DeckEditorPage from './pages/DeckEditorPage.tsx'
import DeckListPage from './pages/DeckListPage.tsx'
import FavoritesPage from './pages/FavoritesPage.tsx'
import CollectionPage from './pages/CollectionPage'
import PacksPage from './pages/PacksPage'
import LoginPage from './pages/LoginPage.tsx'
import MyPage from './pages/MyPage.tsx'
import PricesPage from './pages/PricesPage.tsx'
import { PrivacyPage, TermsPage } from './pages/PolicyPages.tsx'
import SharedDeckPage from './pages/SharedDeckPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'

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
    children: [
      { index: true, element: <CardListPage /> },
      { path: 'cards/:id', element: <CardDetailPage /> },
      { path: 'prices', element: <PricesPage /> },
      { path: 'decks', element: <DeckListPage /> },
      { path: 'decks/shared', element: <SharedDeckPage /> },
      { path: 'decks/:deckId', element: <DeckEditorPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'me', element: <MyPage /> },
      { path: 'favorites', element: <FavoritesPage /> },
      { path: 'packs', element: <PacksPage /> },
      { path: 'collection', element: <CollectionPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
