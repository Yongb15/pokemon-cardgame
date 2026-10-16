import { coverage } from '../../lib/deckSim'
import { isBasicEnergy, type DeckCard } from '../../lib/deck'
import type { CardListItem } from '../../types/card'
import styles from './DeckSimulator.module.css'

/**
 * "내 컬렉션으로 채운 카드 52 / 60장" under the deck checks: information, not a rule. The signed-in owner's
 * editor only (Security D-1); basic Energy counts as covered (docs/deck/simulator.md §1).
 */
export default function CollectionCoverage({ cards, info, owned }: { cards: DeckCard[]; info: Map<string, CardListItem>; owned: Map<string, number> }) {
  const c = coverage(cards, owned, (id) => {
    const card = info.get(id)
    return !!card && isBasicEnergy(card)
  })
  if (!c.total) return null
  const short = c.missing.reduce((n, m) => n + m.need, 0)
  return (
    <details className={styles.coverage}>
      <summary>
        내 컬렉션으로 채운 카드 <b>{c.covered}</b> / {c.total}장{short > 0 && ` (모자란 카드 ${c.missing.length}종 ${short}장)`}
      </summary>
      {c.missing.length > 0 ? (
        <ul>
          {c.missing.map((m) => {
            const card = info.get(m.id)
            return (
              <li key={m.id}>
                {card ? (card.nameKo ?? card.name) : m.id} <b>{m.need}장</b>
              </li>
            )
          })}
        </ul>
      ) : (
        <p>덱의 카드를 모두 가지고 있어요.</p>
      )}
      <p>기본 에너지는 따로 구하기 쉬워서 가지고 있는 것으로 봐요.</p>
    </details>
  )
}
