import { useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, getCard, getRelatedCards, getSetNeighbors } from '../api/cards'
import AddToDeck from '../components/detail/AddToDeck'
import CardAttacks from '../components/detail/CardAttacks'
import { BattleStats, CardInfo, CardRules } from '../components/detail/CardFacts'
import CardImage from '../components/detail/CardImage'
import CardNeighbors from '../components/detail/CardNeighbors'
import CardPrices from '../components/detail/CardPrices'
import HeartButton from '../components/HeartButton'
import RelatedCards from '../components/detail/RelatedCards'
import detail from '../components/detail/detail.module.css'
import { ErrorState, NotFoundState, SlowNotice } from '../components/ListStates'
import { useApiResource } from '../hooks/useApiResource'
import { SUBTYPE_LABEL } from '../lib/cardText'
import { isPokemonType, SUPERTYPE_LABEL, TYPE_COLOR, TYPE_LABEL, TYPE_TEXT } from '../lib/pokemonTypes'
import type { Card } from '../types/card'
import styles from './CardDetailPage.module.css'

/** Router state carried between the list and detail pages */
export interface DetailTrail {
  fromList?: boolean
  depth?: number
}

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
  const trail = (location.state as DetailTrail | null) ?? {}
  // How many history entries back the list is (1 when opened from the list; +1 per related card)
  const listDepth = trail.fromList ? (trail.depth ?? 1) : 0

  const cardResource = useApiResource(`card:${id}`, (signal) => getCard(id, signal))
  const card = cardResource.data
  // Secondary lists load after the card; failures there don't hide the card itself
  const neighbors = useApiResource(card ? `neighbors:${card.id}` : null, (signal) => getSetNeighbors(card!.id, signal))
  const related = useApiResource(card ? `related:${card.id}` : null, (signal) =>
    getRelatedCards(card!.id, RELATED_LIMIT, signal),
  )
  const notFound = cardResource.error instanceof ApiError && cardResource.error.isNotFound

  useEffect(() => {
    document.title = card
      ? `${card.nameKo ?? card.name} · ${SITE_TITLE}`
      : notFound
        ? `카드를 찾을 수 없어요 · ${SITE_TITLE}`
        : SITE_TITLE
    return () => {
      document.title = SITE_TITLE
    }
  }, [card, notFound])

  // Back to the list the user came from (filters, page and scroll intact); otherwise to the start
  const backLink = listDepth ? (
    <button type="button" className={styles.back} onClick={() => navigate(-listDepth)}>
      ‹ 카드 목록
    </button>
  ) : (
    <Link className={styles.back} to="/">
      ‹ 카드 목록
    </Link>
  )

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
            <Link to={`/?set=${encodeURIComponent(card.set.id)}`} title={card.set.nameKo}>
              {card.set.nameKo}
            </Link>
            <span className={styles.sep} aria-hidden="true">
              /
            </span>
            <span aria-current="page" title={card.nameKo ?? card.name}>
              {card.nameKo ?? card.name}
            </span>
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

      {notFound && <meta name="robots" content="noindex" />}
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
                <h1 className={styles.name}>
                  {card.nameKo ?? card.name}
                  {/* The card itself is printed in English: keep that name visible too */}
                  {card.nameKo && (
                    <span className={styles.nameEn} lang="en">
                      {card.name}
                    </span>
                  )}
                </h1>
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
                  <Link
                    className={styles.evolves}
                    to={`/?q=${encodeURIComponent(card.evolvesFromKo ?? card.evolvesFrom)}`}
                  >
                    ← {card.evolvesFromKo ?? card.evolvesFrom}에서 진화
                  </Link>
                )}
                <HeartButton cardId={card.id} cardName={card.nameKo ?? card.name} />
                <AddToDeck key={card.id} card={card} />
              </div>
              {card.nameKoUnofficial && (
                <p className={styles.unofficial}>
                  <span className={styles.unofficialTag}>비공식 번역</span>
                  공식 한글 이름을 확인하지 못한 카드라 직접 번역한 이름이에요.
                </p>
              )}

              <CardAttacks card={card} />
              <CardRules card={card} />
              <BattleStats card={card} />
              <CardInfo card={card} />
              <CardPrices key={card.id} cardId={card.id} />
            </div>
          </div>

          {neighbors.status === 'success' && neighbors.data && (
            <CardNeighbors prev={neighbors.data.prev} next={neighbors.data.next} trail={trail} />
          )}

          <RelatedCards
            card={card}
            status={related.status}
            related={related.data}
            onRetry={related.retry}
            // Opening a related card adds a history entry, so the list is one more step back
            linkState={trail.fromList ? { fromList: true, depth: listDepth + 1 } : undefined}
          />
        </>
      )}
    </main>
  )
}
