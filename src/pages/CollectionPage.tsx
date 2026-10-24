import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { AccountApiError, getCollection, getCollectionSummary, getPackCatalog, type CollectionCard, type CollectionSummary, type PackCatalog, type PackTier } from '../api/account'
import CardImg from '../components/CardImg'
import CardTradeDialog from '../components/CardTradeDialog'
import ListAuctionDialog from '../components/ListAuctionDialog'
import { useCardInfo } from '../hooks/useDecks'
import { useSession } from '../hooks/useSession'
import { rarityLabel } from '../lib/cardText'
import { collectionValue, loadPackPrices, wonKrw } from '../lib/collectionValue'
import { won } from '../lib/points'
import styles from './CollectionPage.module.css'

/**
 * /collection (docs/design/packs-7b.webp ④, collection-value.webp): what the user's packs gave, by card,
 * with set progress and the cards' reference value in won
 */
export default function CollectionPage() {
  const session = useSession()
  const [catalog, setCatalog] = useState<PackCatalog | null>(null)
  const [summary, setSummary] = useState<CollectionSummary | null>(null)
  const [set, setSet] = useState<string | null>(null)
  const [list, setList] = useState<{ key: string; cards: CollectionCard[]; more: boolean; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listing, setListing] = useState<{ cardId: string; name: string } | null>(null)
  const [prices, setPrices] = useState<Record<string, number> | 'error' | null>(null)
  /** The set whose "not collected yet" list is open (v1.15.0 §4) */
  const [openSet, setOpenSet] = useState<string | null>(null)
  /** Exchange or craft in progress (docs/auction/exchange.md §2–3), and a counter that reloads the lists after one */
  const [trade, setTrade] = useState<{ mode: 'exchange'; cardId: string; name: string; max: number; value: number } | { mode: 'craft'; cardId: string; name: string; cost: number } | null>(null)
  const [reload, setReload] = useState(0)
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
    loadPackPrices()
      .then(setPrices)
      .catch(() => setPrices('error'))
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    getCollectionSummary()
      .then(setSummary)
      .catch((e: unknown) => setError(e instanceof AccountApiError ? e.message : '컬렉션을 불러오지 못했어요.'))
  }, [signedIn, reload])

  useEffect(() => {
    if (!signedIn) return
    let stale = false
    getCollection(key || null, 0)
      .then((r) => !stale && setList({ key, cards: r.cards, more: r.more, page: 0 }))
      .catch((e: unknown) => !stale && setError(e instanceof AccountApiError ? e.message : '컬렉션을 불러오지 못했어요.'))
    return () => {
      stale = true
    }
  }, [signedIn, key, reload])

  const current = list?.key === key ? list : null
  const priceMap = prices && prices !== 'error' ? prices : null
  const value = summary && priceMap ? collectionValue(summary.owned, priceMap) : null
  // The "priciest" block is always five rows tall, loading or not, however many cards have a price:
  // nothing below it moves (CLS). Placeholder rows while loading, a note when there are fewer than five
  const topRows = value ? value.top.length : prices === 'error' ? 0 : 5
  // Not collected yet in the open set: its pack pool minus what this user owns, worked out here (the
  // collection never goes back to the server for it)
  const ownedIds = new Set(summary?.owned.map((o) => o.cardId) ?? [])
  const missing = openSet ? (catalog?.sets.find((s) => s.id === openSet)?.cardIds ?? []).filter((id) => !ownedIds.has(id)) : []
  const { info } = useCardInfo([...(current?.cards.map((c) => c.cardId) ?? []), ...(value?.top.map((t) => t.cardId) ?? []), ...missing])

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
  // Each pack card's tier, for what it's worth to exchange (and craft: ×craftFactor)
  const tierOf = new Map(catalog?.sets.flatMap((s) => Object.entries(s.tiers ?? {}).flatMap(([tier, ids]) => (ids ?? []).map((id) => [id, tier as PackTier] as const))) ?? [])
  const values = catalog?.exchange
  const exchangeValue = (cardId: string) => {
    const tier = tierOf.get(cardId)
    return tier && values ? values.values[tier] : null
  }
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
        <div className={styles.value}>
          <dt>참고 시세 합계</dt>
          <dd>{value ? wonKrw(value.total) : prices === 'error' ? '—' : '…'}</dd>
        </div>
      </dl>
      <p className={styles.valueNote}>
        {prices === 'error'
          ? '시세를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'
          : `영문판 TCGplayer 시세(원화)로 계산한 참고값이에요${value ? ` · 시세 있는 ${value.priced}종 기준${value.unpriced ? `, ${value.unpriced}종은 시세 없음` : ''}` : ''} · 포인트와는 무관해요`}
      </p>

      {/* Signed out already went to /login above: shown from the first paint, during the sign-in check too */}
      <section className={styles.top} aria-labelledby="top-title">
        <h2 id="top-title">
          가장 비싼 카드 <small>장당 시세</small>
        </h2>
        <ol>
          {Array.from({ length: topRows }, (_, i) => {
            const t = value?.top[i]
            const card = t ? info.get(t.cardId) : undefined
            return (
              <li key={t?.cardId ?? `slot${i}`}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.thumb}>{card && <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} loading="lazy" />}</span>
                {t ? (
                  <Link className={styles.topName} to={`/cards/${encodeURIComponent(t.cardId)}`}>
                    <b>{card ? (card.nameKo ?? card.name) : t.cardId}</b>
                    <small>
                      {card?.rarity ? rarityLabel(card.rarity) : ' '}
                      {/* The set after the rarity where there's room (qa M8-2) */}
                      {card && <span className={styles.topSet}> · {card.set.nameKo ?? card.set.name}</span>}
                    </small>
                  </Link>
                ) : (
                  <span className={styles.topName} aria-hidden="true">
                    <b> </b>
                    <small> </small>
                  </span>
                )}
                <span className={styles.topPrice}>
                  {t ? wonKrw(t.krw) : ' '}
                  <small>{t ? (t.count > 1 ? `× ${t.count} = ${wonKrw(t.krw * t.count)}` : '× 1') : ' '}</small>
                </span>
              </li>
            )
          })}
        </ol>
        {value && value.top.length < 5 && (
          <p className={styles.topNote}>
            {summary?.owned.length ? (value.top.length ? '시세 있는 카드는 여기까지예요.' : '아직 시세 있는 카드가 없어요.') : '카드팩을 열면 비싼 카드부터 보여 드려요.'}
          </p>
        )}
        {prices === 'error' && <p className={styles.topNote}>시세를 불러오지 못했어요.</p>}
      </section>

      <ul className={styles.progress} aria-label="세트별 모은 카드">
        {(progress.length ? progress : Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, owned: 0, total: 0 }))).map((s) => (
          <li key={s.id}>
            {progress.length && summary && s.total ? (
              <button type="button" className={styles.setToggle} aria-expanded={openSet === s.id} onClick={() => setOpenSet(openSet === s.id ? null : s.id)}>
                {setName(s.id)}
              </button>
            ) : (
              <span>{progress.length ? setName(s.id) : ' '}</span>
            )}
            <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.owned} aria-label={`${setName(s.id)} 모은 카드`}>
              <i className={s.total && s.owned >= s.total ? styles.barDone : undefined} style={{ width: s.total ? `${Math.min(100, (s.owned / s.total) * 100)}%` : 0 }} />
            </span>
            <span className={styles.count}>
              {s.total ? (s.owned >= s.total ? <b className={styles.done}>완성 ✓</b> : `${s.owned}/${s.total} · ${Math.floor((s.owned / s.total) * 100)}%`) : ' '}
            </span>
            {openSet === s.id && (
              <div className={styles.missing}>
                {missing.length ? (
                  <>
                    <p>아직 못 모은 카드 {missing.length}장</p>
                    <ul>
                      {missing.map((id) => {
                        const card = info.get(id)
                        return (
                          <li key={id}>
                            <Link to={`/cards/${encodeURIComponent(id)}`}>{card ? (card.nameKo ?? card.name) : id}</Link>
                            {values && exchangeValue(id) !== null && (
                              <button
                                type="button"
                                className={styles.craftButton}
                                onClick={() => setTrade({ mode: 'craft', cardId: id, name: card ? (card.nameKo ?? card.name) : id, cost: exchangeValue(id)! * values.craftFactor })}
                              >
                                만들기 {won(exchangeValue(id)! * values.craftFactor)}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : (
                  <p>이 세트의 카드를 모두 모았어요!</p>
                )}
              </div>
            )}
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
              // Copies that can go up for auction: not a test copy, not already listed (K-3)
              const free = c.count - c.test - c.listed
              // Copies that can be exchanged: the same, and one of those always stays (exchange.md §2, I-x1)
              const spare = Math.min(free - 1, 50)
              const value = exchangeValue(c.cardId)
              return (
                <li key={c.cardId} className={styles.cell}>
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
                    <span className={priceMap && Object.hasOwn(priceMap, c.cardId) ? styles.price : styles.noPrice}>
                      {priceMap ? (Object.hasOwn(priceMap, c.cardId) ? wonKrw(priceMap[c.cardId]!) : '시세 없음') : ' '}
                    </span>
                  </Link>
                  {spare > 0 && value !== null && (
                    <button type="button" className={styles.listButton} aria-label={`${name} 교환, 1장에 ${won(value)}`} onClick={() => setTrade({ mode: 'exchange', cardId: c.cardId, name, max: spare, value })}>
                      교환 {won(value)}
                    </button>
                  )}
                  {free > 0 ? (
                    <button type="button" className={styles.listButton} aria-label={`${name} 경매 등록`} onClick={() => setListing({ cardId: c.cardId, name })}>
                      경매 등록
                    </button>
                  ) : (
                    <span className={styles.listNote}>{c.listed > 0 ? '경매 중' : c.test > 0 ? '테스트 카드' : ' '}</span>
                  )}
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
      <p className={styles.small}>덱과 컬렉션은 별개예요 — 컬렉션 카드를 팔아도 덱에서 빠지지 않아요.</p>
      {listing && <ListAuctionDialog cardId={listing.cardId} name={listing.name} onClose={() => setListing(null)} />}
      {trade && <CardTradeDialog {...trade} onClose={() => setTrade(null)} onDone={() => setReload((n) => n + 1)} />}
    </main>
  )
}
