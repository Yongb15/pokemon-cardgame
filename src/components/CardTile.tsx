import { Link } from 'react-router'
import CardImg from './CardImg'
import { formatCardNumber } from '../lib/cardText'
import { isPokemonType, SUPERTYPE_LABEL, TYPE_COLOR, TYPE_LABEL, TYPE_TEXT } from '../lib/pokemonTypes'
import type { CardListItem } from '../types/card'
import styles from './CardTile.module.css'

function TypeBadge({ card }: { card: CardListItem }) {
  const type = card.types?.[0]
  if (type && isPokemonType(type)) {
    return (
      <span className={styles.badge} style={{ background: TYPE_COLOR[type], color: TYPE_TEXT[type] }}>
        <span className={styles.badgeDot} aria-hidden="true" />
        {TYPE_LABEL[type]}
      </span>
    )
  }
  return <span className={`${styles.badge} ${styles.neutral}`}>{SUPERTYPE_LABEL[card.supertype] ?? card.supertype}</span>
}

export default function CardTile({ card }: { card: CardListItem }) {
  const isRare = /rare|legend/i.test(card.rarity ?? '')

  return (
    // `fromList` lets the detail page go back with history (keeping filters and scroll)
    <Link className={styles.card} to={`/cards/${encodeURIComponent(card.id)}`} state={{ fromList: true, depth: 1 }}>
      <CardImg
        className={styles.image}
        src={card.images.small}
        fallback={card.images.fallbackSmall}
        alt="" /* the name below labels the link */
        width={245}
        height={342}
        loading="lazy"
        decoding="async"
      />
      <div className={styles.meta}>
        <h3 className={styles.name} title={card.nameKo ? `${card.nameKo} (${card.name})` : card.name}>
          {card.nameKo ?? card.name}
        </h3>
        {card.nameKo && (
          <p className={styles.nameEn} lang="en">
            {card.name}
          </p>
        )}
        <p className={styles.sub}>
          {formatCardNumber(card.number)} · {card.set.name}
        </p>
        <div className={styles.row}>
          <TypeBadge card={card} />
          {card.hp && (
            <span className={styles.hp}>
              <small>HP</small>
              {card.hp}
            </span>
          )}
        </div>
        {card.rarity && <p className={isRare ? `${styles.rarity} ${styles.rare}` : styles.rarity}>{card.rarity}</p>}
      </div>
    </Link>
  )
}
