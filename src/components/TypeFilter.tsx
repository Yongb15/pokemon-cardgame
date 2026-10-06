import { POKEMON_TYPES, TYPE_COLOR, TYPE_LABEL, type PokemonType } from '../lib/pokemonTypes'
import styles from './TypeFilter.module.css'

interface Props {
  value: PokemonType | ''
  onChange: (value: PokemonType | '') => void
}

export default function TypeFilter({ value, onChange }: Props) {
  return (
    <div className={styles.chips} role="group" aria-label="타입">
      <button type="button" className={styles.chip} aria-pressed={value === ''} onClick={() => onChange('')}>
        전체
      </button>
      {POKEMON_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={styles.chip}
          aria-pressed={value === type}
          onClick={() => onChange(value === type ? '' : type)}
        >
          <span className={styles.dot} style={{ background: TYPE_COLOR[type] }} aria-hidden="true" />
          {TYPE_LABEL[type]}
        </button>
      ))}
    </div>
  )
}
