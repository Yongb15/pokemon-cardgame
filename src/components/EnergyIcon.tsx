import { isPokemonType, TYPE_COLOR, TYPE_LABEL, TYPE_TEXT } from '../lib/pokemonTypes'
import styles from './EnergyIcon.module.css'

/** A colored energy symbol with the type's first Korean letter, e.g. 불 for Fire. */
export default function EnergyIcon({ type, size = 22 }: { type: string; size?: number }) {
  const known = isPokemonType(type)
  const label = known ? TYPE_LABEL[type] : type
  return (
    <span
      className={styles.energy}
      role="img"
      aria-label={`${label} 에너지`}
      title={`${label} 에너지`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: known ? TYPE_COLOR[type] : 'var(--surface-muted)',
        color: known ? TYPE_TEXT[type] : 'var(--text)',
      }}
    >
      {known ? label[0] : '?'}
    </span>
  )
}
