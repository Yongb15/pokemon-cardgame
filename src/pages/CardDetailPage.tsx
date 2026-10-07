import { useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, getCard, getRelatedCards, getSetNeighbors } from '../api/pokemonTcg'
import CardAttacks from '../components/detail/CardAttacks'
import { BattleStats, CardInfo, CardRules } from '../components/detail/CardFacts'
import CardImage from '../components/detail/CardImage'
import CardNeighbors from '../components/detail/CardNeighbors'
import CardPrices from '../components/detail/CardPrices'
import RelatedCards from '../components/detail/RelatedCards'
import detail from '../components/detail/detail.module.css'
import { ErrorState, NotFoundState, SlowNotice } from '../components/ListStates'
import { useApiResource } from '../hooks/useApiResource'
import { SUBTYPE_LABEL } from '../lib/cardText'
import { isPokemonType, SUPERTYPE_LABEL, TYPE_COLOR, TYPE_LABEL, TYPE_TEXT } from '../lib/pokemonTypes'
import type { Card } from '../types/card'
import styles from './CardDetailPage.module.css'

const RELATED_LIMIT = 6
const SITE_TITLE = 'Pokémon Card Dex'

function TypeBadges({ card }: { card: Card }) {
  return (
    <>
      {(card.types ?? []).filter(isPokemonType).map((type) => (
        <span key={type} className={detail.badge} style={{ background: TYPE_COLOR[type], color: TYPE_TEXT[type] }}>
          <span className={detail.badgeDot} aria-hidden="true" />
          {TYPE_LABEL[type]}
        </span>
      ))}
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className={styles.layout} aria-busy="true" aria-label="카드 정보를 불러오는 중">
      <div className={`${styles.skeleton} ${styles.skeletonImage}`} />
      <div className={styles.skeletonLines}>
        <div className={styles.skeleton} style={{ height: 40, width: '60%' }} />
        <div className={styles.skeleton} style={{ height: 16, width: '40%' }} />
        <div className={styles.skeleton} style={{ height: 88, marginTop: 24 }} />
        <div className={styles.skeleton} style={{ height: 88 }} />
        <div className={styles.skeleton} style={{ height: 64 }} />
      </div>
    </div>
  )
}

export default function CardDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const fromList = Boolean((location.state as { fromList?: boolean } | null)?.fromList)

  const cardResource = useApiResource(`card:${id}`, (signal) => getCard(id, signal))
  const card = cardResource.data
  // Secondary lists load after the card; failures there don't hide the card itself
  const neighbors = useApiResource(card ? `neighbors:${card.id}` : null, (signal) => getSetNeighbors(card!, signal))
  const related = useApiResource(card ? `related:${card.id}` : null, (signal) =>
    getRelatedCards(card!, RELATED_LIMIT, signal),
  )

  useEffect(() => {
    document.title = card ? `${card.name} · ${SITE_TITLE}` : SITE_TITLE
    return () => {
      document.title = SITE_TITLE
    }
  }, [card])

  // Back to the list the user came from (filters, page and scroll intact); otherwise to the start
  const backLink = fromList ? (
    <button type="button" className={styles.back} onClick={() => navigate(-1)}>
      ‹ 카드 목록
    </button>
  ) : (
    <Link className={styles.back} to="/">
      ‹ 카드 목록
    </Link>
  )

  const notFound = cardResource.error instanceof ApiError && cardResource.error.isNotFound
  const subtitle = card
    ? [SUPERTYPE_LABEL[card.supertype] ?? card.supertype, ...(card.subtypes ?? []).map((s) => SUBTYPE_LABEL[s] ?? s)].join(
        ' · ',
      )
    : ''

  return (
    <main className={styles.main}>
      <nav className={styles.crumbs} aria-label="위치">
        {backLink}
        {card && (
          <>
            <span className={styles.sep} aria-hidden="true">
              /
            </span>
            <Link to={`/?set=${encodeURIComponent(card.set.id)}`}>{card.set.name}</Link>
            <span className={styles.sep} aria-hidden="true">
              /
            </span>
            <span aria-current="page">{card.name}</span>
          </>
        )}
      </nav>

      {cardResource.status === 'loading' && (
        <>
          {cardResource.slow && (
            <div className={styles.slow}>
              <SlowNotice />
            </div>
          )}
          <DetailSkeleton />
        </>
      )}

      {notFound && (
        <div className={styles.message}>
          <NotFoundState
            title="카드를 찾을 수 없어요"
            description={
              <>
                주소가 잘못되었거나 삭제된 카드입니다.
                <br />({id})
              </>
            }
          />
        </div>
      )}

      {cardResource.status === 'error' && !notFound && cardResource.error && (
        <div className={styles.message}>
          <ErrorState error={cardResource.error} onRetry={cardResource.retry} />
        </div>
      )}

      {card && (
        <>
          <div className={styles.layout}>
            <CardImage card={card} />

            <div className={styles.info}>
              <div className={styles.titleRow}>
                <h1 className={styles.name}>{card.name}</h1>
                {card.hp && (
                  <p className={styles.hp}>
                    <small>HP</small>
                    {card.hp}
                  </p>
                )}
              </div>
              <div className={styles.subRow}>
                <TypeBadges card={card} />
                <span className={styles.subtitle}>{subtitle}</span>
                {card.evolvesFrom && (
                  <Link className={styles.evolves} to={`/?q=${encodeURIComponent(card.evolvesFrom)}`}>
                    ← {card.evolvesFrom}에서 진화
                  </Link>
                )}
              </div>

              <CardAttacks card={card} />
              <CardRules card={card} />
              <BattleStats card={card} />
              <CardInfo card={card} />
              <CardPrices card={card} />
            </div>
          </div>

          {neighbors.status === 'success' && neighbors.data && (
            <CardNeighbors prev={neighbors.data.prev} next={neighbors.data.next} fromList={fromList} />
          )}

          <RelatedCards card={card} status={related.status} related={related.data} onRetry={related.retry} />
        </>
      )}
    </main>
  )
}
