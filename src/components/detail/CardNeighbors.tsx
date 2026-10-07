import { Link } from 'react-router'
import { formatCardNumber } from '../../lib/cardText'
import type { DetailTrail } from '../../pages/CardDetailPage'
import type { CardSummary } from '../../types/card'
import CardImg from '../CardImg'
import styles from './detail.module.css'

interface Props {
  prev: CardSummary | null
  next: CardSummary | null
  /** Carried along unchanged (these links replace the entry) so "카드 목록" still goes back in history */
  trail: DetailTrail
}

/**
 * Previous / next card in the same set. These replace the history entry, so the browser's back
 * button (and "카드 목록") returns to the list instead of stepping through every card viewed.
 */
export default function CardNeighbors({ prev, next, trail }: Props) {
  if (!prev && !next) return null
  const link = (card: CardSummary, dir: 'prev' | 'next') => (
    <Link
      className={dir === 'next' ? `${styles.neighbor} ${styles.neighborNext}` : styles.neighbor}
      to={`/cards/${encodeURIComponent(card.id)}`}
      state={trail}
      replace
      rel={dir}
    >
      <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" loading="lazy" />
      <span>
        <span className={styles.neighborLabel}>{dir === 'prev' ? '‹ 이전 카드' : '다음 카드 ›'}</span>
        <span className={styles.neighborName}>
          <span className={styles.neighborNumber}>{formatCardNumber(card.number)}</span> {card.nameKo ?? card.name}
        </span>
      </span>
    </Link>
  )

  return (
    <nav className={styles.neighbors} aria-label="같은 세트의 이전·다음 카드">
      {prev ? link(prev, 'prev') : <span />}
      {next ? link(next, 'next') : <span />}
    </nav>
  )
}
