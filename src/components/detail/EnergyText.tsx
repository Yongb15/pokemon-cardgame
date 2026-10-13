import EnergyIcon from '../EnergyIcon'
import styles from './detail.module.css'

const TYPES = 'Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless'
// Two or more type names glued together ("ColorlessColorless", "FightingDarknessFairy"): the
// source data lost the card's energy symbols there. One type name in a sentence is just a word.
const GLUED = new RegExp(`(?<![A-Za-z])((?:${TYPES}){2,})(?![a-z])`, 'g')
const ONE = new RegExp(TYPES, 'g')

/** Card text with the lost energy symbols drawn back as icons (English original only has them) */
export default function EnergyText({ text }: { text: string }) {
  const parts = text.split(GLUED)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 0 ? (
      part
    ) : (
      <span key={i} className={styles.inlineEnergy}>
        {part.match(ONE)!.map((type, j) => (
          <EnergyIcon key={j} type={type} size={16} />
        ))}
      </span>
    ),
  )
}
