import type { Card } from '../../types/card'
import EnergyIcon from '../EnergyIcon'
import styles from './detail.module.css'

/** Abilities and attacks, in card order (abilities sit above attacks on the card). */
export default function CardAttacks({ card }: { card: Card }) {
  const abilities = card.abilities ?? []
  const attacks = card.attacks ?? []
  if (abilities.length === 0 && attacks.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="moves-heading">
      <h2 id="moves-heading" className={styles.sectionTitle}>
        {abilities.length > 0 ? '특성 · 기술' : '기술'}
      </h2>

      {abilities.map((ability) => (
        <div key={ability.name} className={`${styles.move} ${styles.ability}`}>
          <span className={styles.abilityTag} title={ability.type}>
            특성
          </span>
          <h3 className={styles.moveName}>{ability.name}</h3>
          <p className={styles.moveText}>{ability.text}</p>
        </div>
      ))}

      {attacks.map((attack) => {
        const cost = attack.cost.filter((type) => type !== 'Free')
        return (
          <div key={attack.name} className={styles.move}>
            <div className={styles.cost} aria-label={cost.length ? undefined : '에너지 없음'}>
              {cost.length ? cost.map((type, i) => <EnergyIcon key={i} type={type} />) : <span className={styles.free}>—</span>}
            </div>
            <h3 className={styles.moveName}>{attack.name}</h3>
            {attack.damage && <span className={styles.damage}>{attack.damage}</span>}
            {attack.text && <p className={styles.moveText}>{attack.text}</p>}
          </div>
        )
      })}
    </section>
  )
}
