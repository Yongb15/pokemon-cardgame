import { Link } from 'react-router'
import { baseName } from '../../lib/cardText'
import type { DetailTrail } from '../../pages/CardDetailPage'
import type { Card, CardSummary } from '../../types/card'
import styles from './detail.module.css'

interface Props {
  card: Card
  status: 'idle' | 'loading' | 'success' | 'error'
  related?: { cards: CardSummary[]; totalCount: number }
  onRetry: () => void
  linkState?: DetailTrail
}

export default function RelatedCards({ card, status, related, onRetry, linkState }: Props) {
  if (status === 'success' && !related?.cards.length) return null
  const name = baseName(card.name)

  return (
    <section className={`${styles.section} ${styles.related}`} aria-labelledby="related-heading">
      <h2 id="related-heading" className={styles.sectionTitle}>
        다른 {name} 카드
        {status === 'success' && related && (
          <Link className={styles.sectionLink} to={`/?q=${encodeURIComponent(name)}`}>
            모두 보기 ›
          </Link>
        )}
      </h2>

      {status === 'error' ? (
        <p className={styles.inlineError}>
          관련 카드를 불러오지 못했어요.{' '}
          <button type="button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      ) : (
        <ul className={styles.relatedRow} aria-busy={status === 'loading' || undefined}>
          {status === 'success' && related
            ? related.cards.map((c) => (
                <li key={c.id}>
                  <Link className={styles.mini} to={`/cards/${encodeURIComponent(c.id)}`} state={linkState}>
                    <img src={c.images.small} alt="" loading="lazy" width={245} height={342} />
                    <span className={styles.miniName}>{c.name}</span>
                    <span className={styles.miniSet}>{c.set.name}</span>
                  </Link>
                </li>
              ))
            : Array.from({ length: 6 }, (_, i) => (
                <li key={i} aria-hidden="true">
                  <div className={styles.miniSkeleton} />
                </li>
              ))}
        </ul>
      )}
    </section>
  )
}
