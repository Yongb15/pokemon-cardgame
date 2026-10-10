import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { AccountApiError, getCollection, getCollectionSummary, getPackCatalog, type CollectionCard, type CollectionSummary, type PackCatalog } from '../api/account'
import CardImg from '../components/CardImg'
import { useCardInfo } from '../hooks/useDecks'
import { useSession } from '../hooks/useSession'
import { rarityLabel } from '../lib/cardText'
import styles from './CollectionPage.module.css'

/** /collection (docs/design/packs-7b.webp ④): what the user's packs gave, by card, with set progress */
export default function CollectionPage() {
  const session = useSession()
  const [catalog, setCatalog] = useState<PackCatalog | null>(null)
  const [summary, setSummary] = useState<CollectionSummary | null>(null)
  const [set, setSet] = useState<string | null>(null)
  const [list, setList] = useState<{ key: string; cards: CollectionCard[]; more: boolean; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const signedIn = session.status === 'in'
  const key = set ?? ''

  useEffect(() => {
    document.title = '내 컬렉션 · Pokémon Card Dex'
    getPackCatalog()
      .then(setCatalog)
      .catch(() => undefined)
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  useEffect(() => {
    if (!signedIn) return
    getCollectionSummary()
      .then(setSummary)
      .catch((e: unknown) => setError(e instanceof AccountApiError ? e.message : '컬렉션을 불러오지 못했어요.'))
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    let stale = false
    getCollection(key || null, 0)
      .then((r) => !stale && setList({ key, cards: r.cards, more: r.more, page: 0 }))
      .catch((e: unknown) => !stale && setError(e instanceof AccountApiError ? e.message : '컬렉션을 불러오지 못했어요.'))
    return () => {
      stale = true
    }
  }, [signedIn, key])

  const current = list?.key === key ? list : null
  const { info } = useCardInfo(current?.cards.map((c) => c.cardId) ?? [])

  if (session.status === 'out') return <Navigate to="/login?next=%2Fcollection" replace />

  const more = async () => {
    if (!current) return
    setLoadingMore(true)
    try {
      const r = await getCollection(key || null, current.page + 1)
      setList({ key, cards: [...current.cards, ...r.cards], more: r.more, page: current.page + 1 })
    } catch (e) {
      setError(e instanceof AccountApiError ? e.message : '더 불러오지 못했어요.')
    } finally {
      setLoadingMore(false)
    }
  }

  const setName = (id: string) => catalog?.sets.find((s) => s.id === id)?.nameKo ?? id
  // Every pack set, owned or not: the block keeps one height while it loads (qa B)
  const progress = summary?.sets ?? catalog?.sets.map((s) => ({ id: s.id, owned: 0, total: s.cards })) ?? []

  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <div className={styles.head}>
        <h1 className={styles.title}>내 컬렉션</h1>
        <Link className={styles.primary} to="/packs">
          카드팩 열기
        </Link>
      </div>

      <dl className={styles.sum}>
        <div>
          <dt>모은 카드</dt>
          <dd>{summary ? `${summary.cards.toLocaleString('ko-KR')}장` : '…'}</dd>
        </div>
        <div>
          <dt>서로 다른 카드</dt>
          <dd>{summary ? `${summary.distinct.toLocaleString('ko-KR')}종` : '…'}</dd>
        </div>
      </dl>

      <ul className={styles.progress} aria-label="세트별 모은 카드">
        {(progress.length ? progress : Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, owned: 0, total: 0 }))).map((s) => (
          <li key={s.id}>
            <span>{progress.length ? setName(s.id) : ' '}</span>
            <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.owned} aria-label={`${setName(s.id)} 모은 카드`}>
              <i style={{ width: s.total ? `${(s.owned / s.total) * 100}%` : 0 }} />
            </span>
            <span className={styles.count}>{s.total ? `${s.owned}/${s.total}` : ' '}</span>
          </li>
        ))}
      </ul>

      <div className={styles.chips} role="group" aria-label="세트">
        <button type="button" aria-pressed={set === null} onClick={() => setSet(null)}>
          전체
        </button>
        {catalog?.sets.map((s) => (
          <button key={s.id} type="button" aria-pressed={set === s.id} onClick={() => setSet(s.id)}>
            {s.nameKo}
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : !current ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
      ) : current.cards.length === 0 ? (
        <div className={styles.empty}>
          <h2>{set ? `${setName(set)}에서 모은 카드가 없어요` : '아직 모은 카드가 없어요'}</h2>
          <p className={styles.small}>카드팩을 열면 여기에 모여요.</p>
          <Link className={styles.primary} to="/packs">
            카드팩 열기
          </Link>
        </div>
      ) : (
        <>
          <ul className={styles.grid}>
            {current.cards.map((c) => {
              const card = info.get(c.cardId)
              const name = card ? (card.nameKo ?? card.name) : c.cardId
              return (
                <li key={c.cardId}>
                  <Link className={styles.tile} to={`/cards/${encodeURIComponent(c.cardId)}`}>
                    <span className={styles.img}>
                      {card && <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} loading="lazy" />}
                      {c.count > 1 && (
                        <span className={styles.badge} aria-label={`${c.count}장 보유`}>
                          ×{c.count}
                        </span>
                      )}
                      {c.test > 0 && <span className={styles.testBadge}>테스트</span>}
                    </span>
                    <b>{name}</b>
                    <small>{card?.rarity ? rarityLabel(card.rarity) : ' '}</small>
                  </Link>
                </li>
              )
            })}
          </ul>
          {current.more && (
            <button type="button" className={styles.button} onClick={() => void more()} disabled={loadingMore}>
              {loadingMore ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </>
      )}
      <p className={styles.small}>덱과 컬렉션은 별개예요 — 컬렉션 카드를 팔아도 덱에서 빠지지 않아요. 경매 등록은 곧 열려요.</p>
    </main>
  )
}
