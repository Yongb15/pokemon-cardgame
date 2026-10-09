import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { getCardsBatch } from '../api/cards'
import CardGrid from '../components/CardGrid'
import CardTile from '../components/CardTile'
import { HeartIcon } from '../components/HeartButton'
import { loadFavorites, toggleFavorite, useFavorites } from '../hooks/useFavorites'
import { useSession } from '../hooks/useSession'
import type { CardListItem } from '../types/card'
import styles from './AccountPages.module.css'

const MAX_FAVORITES = 500

/** /favorites (docs/design/favorites.webp): hearted cards, newest first, each with a remove button */
export default function FavoritesPage() {
  const session = useSession()
  const favorites = useFavorites()
  const [cards, setCards] = useState<Map<string, CardListItem>>(new Map())
  // Ids already asked for: a card the data no longer has isn't asked for again and again
  const [tried, setTried] = useState<Set<string>>(new Set())
  const [cardsError, setCardsError] = useState(false)
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useMemo(() => (favorites.status === 'ready' ? favorites.ids : []), [favorites])
  const undoRef = useRef<HTMLButtonElement>(null)

  // The remove button is gone with its tile: keyboard focus goes to "다시 담기" (qa Info)
  useEffect(() => {
    if (removed) undoRef.current?.focus()
  }, [removed])

  useEffect(() => {
    document.title = '관심 카드 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  // Card details for ids we haven't fetched yet (60 per request)
  const missing = ids.filter((id) => !tried.has(id))
  const missingKey = missing.join(',')
  useEffect(() => {
    if (!missingKey) return
    const controller = new AbortController()
    getCardsBatch(missingKey.split(','), controller.signal)
      .then((list) => {
        setCardsError(false)
        setCards((prev) => new Map([...prev, ...list.map((c) => [c.id, c] as const)]))
        setTried((prev) => new Set([...prev, ...missingKey.split(',')]))
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setCardsError(true)
      })
    return () => controller.abort()
  }, [missingKey])

  if (session.status === 'out') return <Navigate to="/login?next=%2Ffavorites" replace />

  const onRemove = async (id: string, name: string) => {
    setError(null)
    const failed = await toggleFavorite(id)
    if (failed) setError(failed)
    else setRemoved({ id, name })
  }

  const onUndo = async () => {
    if (!removed) return
    const failed = await toggleFavorite(removed.id)
    if (failed) setError(failed)
    setRemoved(null)
  }

  // Ids the card data no longer has still take a slot: show them so they can be removed (qa H-2)
  const shown = ids.filter((id) => cards.has(id) || tried.has(id))
  const loading = session.status === 'unknown' || favorites.status === 'idle' || favorites.status === 'loading'

  return (
    <main className={styles.wide}>
      <meta name="robots" content="noindex" />
      <div>
        <h1 className={styles.title}>관심 카드</h1>
        {favorites.status === 'ready' && (
          <p className={styles.small}>
            {ids.length}장 / {MAX_FAVORITES} · 최근에 담은 순
          </p>
        )}
      </div>

      {removed && (
        <p className={styles.notice} role="status">
          {/* "찾을 수 없는 카드(id)" ends in a bracket: plain "를" reads better there (qa Info) */}
          {removed.name}
          {removed.name.endsWith(')') ? '를' : '을(를)'} 관심 카드에서 뺐어요.{' '}
          {/* Re-adding puts it first again: the server keeps when it was hearted (qa H-4) */}
          <button type="button" ref={undoRef} className={styles.linkButton} onClick={() => void onUndo()}>
            다시 담기
          </button>
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      {session.status === 'error' || favorites.status === 'error' ? (
        <p className={styles.alert} role="alert">
          {favorites.status === 'error' ? favorites.message : '로그인 상태를 확인하지 못했어요.'}{' '}
          <button type="button" className={styles.linkButton} onClick={() => void loadFavorites()}>
            다시 시도
          </button>
        </p>
      ) : loading ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
      ) : ids.length === 0 ? (
        <div className={styles.empty}>
          <h2>아직 담은 카드가 없어요</h2>
          <p className={styles.small}>카드 상세에서 ♡ 관심 카드를 누르면 여기에 모여요.</p>
          <Link className={styles.primary} to="/">
            카드 보러 가기
          </Link>
        </div>
      ) : (
        <>
          {cardsError && (
            <p className={styles.alert} role="alert">
              카드 정보를 일부 불러오지 못했어요. 새로고침해 주세요.
            </p>
          )}
          <CardGrid busy={missing.length > 0}>
            {shown.map((id) => {
              const card = cards.get(id)
              const name = card ? (card.nameKo ?? card.name) : `찾을 수 없는 카드(${id})`
              return (
                <div key={id} className={styles.favTile}>
                  {card ? (
                    <CardTile card={card} />
                  ) : (
                    <div className={styles.goneTile}>
                      <b>찾을 수 없는 카드</b>
                      <span className={styles.small}>{id}</span>
                      <span className={styles.small}>카드 데이터에서 빠졌어요.</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.favRemove}
                    aria-label={`${name} 관심 카드에서 빼기`}
                    onClick={() => void onRemove(id, name)}
                  >
                    <HeartIcon filled />
                  </button>
                </div>
              )
            })}
          </CardGrid>
        </>
      )}
    </main>
  )
}
