import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { collectionValue, wonKrw } from '../../lib/collectionValue'
import { isBasicEnergy, type DeckCard } from '../../lib/deck'
import { loadDeckPrices } from '../../lib/deckPrices'
import type { CardListItem } from '../../types/card'
import styles from './DeckCost.module.css'

/** Wait this long after the last +/− before asking for prices (Security D-6) */
const DEBOUNCE_MS = 1000

/**
 * "참고 시세 합계" under the deck composition (docs/release/v1.15.0-design.md §3): the deck's cards times each
 * card's headline price in won. Reference only: real-card prices, not points. Basic Energy is left out.
 */
export default function DeckCost({ cards, info }: { cards: DeckCard[]; info: Map<string, CardListItem> }) {
  // Only ids our card data knows (a shared link may carry anything), and no basic Energy
  const counted = cards.filter((c) => {
    const card = info.get(c.id)
    return !!card && !isBasicEnergy(card)
  })
  const ids = counted.map((c) => c.id)
  const key = [...new Set(ids)].sort().join(',')
  const [state, setState] = useState<{ key: string; prices?: Record<string, number>; error?: boolean } | null>(null)

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      loadDeckPrices(key.split(','), controller.signal).then(
        (prices) => setState({ key, prices }),
        (error: unknown) => {
          // No retry loop: the next change to the deck asks again
          if (!(error instanceof DOMException && error.name === 'AbortError')) setState({ key, error: true })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  if (!key) return null
  const current = state?.key === key ? state : null
  const value = current?.prices ? collectionValue(counted.map((c) => ({ cardId: c.id, count: c.count })), current.prices) : null
  const pricedCopies = value ? counted.filter((c) => Object.hasOwn(current!.prices!, c.id)).reduce((n, c) => n + c.count, 0) : 0
  const totalCopies = counted.reduce((n, c) => n + c.count, 0)

  return (
    <section className={styles.cost} aria-label="덱 참고 시세">
      <h3 className={styles.heading}>참고 시세 합계</h3>
      {/* One height from the first frame: the numbers fill in later (CLS) */}
      <p className={styles.total} aria-live="polite">
        {current?.error ? '시세를 불러오지 못했어요.' : value ? <b>{wonKrw(value.total)}</b> : '…'}
        {value && <span> · 시세 있는 카드 {pricedCopies}/{totalCopies}장</span>}
      </p>
      {value && value.top.length > 0 && (
        <ol className={styles.top}>
          {value.top.map((v) => {
            const card = info.get(v.cardId)
            return (
              <li key={v.cardId}>
                <Link to={`/cards/${encodeURIComponent(v.cardId)}`}>{card ? (card.nameKo ?? card.name) : v.cardId}</Link>
                <span>
                  {v.count}장 × {wonKrw(v.krw)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <p className={styles.note}>영문판 TCGplayer 시세를 원화로 바꾼 참고값이에요. 포인트와는 관계없고, 기본 에너지는 빼고 셌어요.</p>
    </section>
  )
}
