import { Link } from 'react-router'
import { formatCardNumber } from '../../lib/cardText'
import { isBasicEnergy, MAX_COPIES, ruleName, type DeckCard } from '../../lib/deck'
import type { CardListItem } from '../../types/card'
import CardImg from '../CardImg'
import styles from './deck.module.css'

const GROUPS = [
  ['Pokémon', '포켓몬'],
  ['Trainer', '트레이너스'],
  ['Energy', '에너지'],
] as const

interface Props {
  cards: DeckCard[]
  info: Map<string, CardListItem>
  /** Copies per rule name, to stop "+" at four. Leave out `onChange` for a read-only list. */
  nameCounts?: Map<string, number>
  onChange?: (card: CardListItem, delta: 1 | -1) => void
  /** Lay the three groups side by side (shared deck page) */
  columns?: boolean
}

/** The deck's cards grouped into Pokémon / Trainer / Energy, with +/- steppers when editable */
export default function DeckCardList({ cards, info, nameCounts, onChange, columns }: Props) {
  return (
    <div className={columns ? `${styles.groups} ${styles.columns}` : styles.groups}>
      {GROUPS.map(([supertype, label]) => {
        const rows = cards.flatMap(({ id, count }) => {
          const card = info.get(id)
          return card?.supertype === supertype ? [{ card, count }] : []
        })
        const total = rows.reduce((n, r) => n + r.count, 0)
        return (
          <section key={supertype} className={styles.group} aria-label={`${label} ${total}장`}>
            <h3 className={styles.groupTitle}>
              {label} <span>{total}</span>
            </h3>
            {rows.length === 0 && <p className={styles.groupEmpty}>아직 없어요</p>}
            <ul className={styles.rows}>
              {rows.map(({ card, count }) => {
                const atLimit = !isBasicEnergy(card) && (nameCounts?.get(ruleName(card.name)) ?? 0) >= MAX_COPIES
                const name = card.nameKo ?? card.name
                return (
                  <li key={card.id} className={styles.row}>
                    <CardImg
                      className={styles.rowImage}
                      src={card.images.small}
                      fallback={card.images.fallbackSmall}
                      alt=""
                      width={245}
                      height={342}
                      loading="lazy"
                    />
                    <div className={styles.rowText}>
                      <Link to={`/cards/${encodeURIComponent(card.id)}`} className={styles.rowName}>
                        {name}
                      </Link>
                      <span className={styles.rowSub}>
                        {card.nameKo && <span lang="en">{card.name} · </span>}
                        {card.set.name} {formatCardNumber(card.number)}
                      </span>
                    </div>
                    {onChange ? (
                      <div className={styles.stepper} role="group" aria-label={`${name} 수량`}>
                        <button type="button" onClick={() => onChange(card, -1)} aria-label={`${name} 1장 빼기`}>
                          −
                        </button>
                        <span className={styles.qty} aria-live="polite">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => onChange(card, 1)}
                          disabled={atLimit}
                          aria-label={`${name} 1장 더하기`}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span className={styles.qty}>{count}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
