import { setOriginalText, useOriginalText } from '../../hooks/useCardText'
import type { Card } from '../../types/card'
import EnergyIcon from '../EnergyIcon'
import styles from './detail.module.css'

/** Abilities and attacks, in card order (abilities sit above attacks on the card). */
export default function CardAttacks({ card }: { card: Card }) {
  const abilities = card.abilities ?? []
  const attacks = card.attacks ?? []
  const original = useOriginalText()
  if (abilities.length === 0 && attacks.length === 0) return null
  const translated = [...abilities, ...attacks].some((m) => m.nameKo || m.textKo)
  const name = (m: { name: string; nameKo?: string }) => (!original && m.nameKo) || m.name
  const text = (m: { text?: string; textKo?: string }) => (!original && m.textKo) || m.text

  return (
    <section className={styles.section} aria-labelledby="moves-heading">
      <h2 id="moves-heading" className={styles.sectionTitle}>
        {abilities.length > 0 ? '특성 · 기술' : '기술'}
        {translated && <TextToggle original={original} />}
      </h2>

      {abilities.map((ability) => (
        <div key={ability.name} className={`${styles.move} ${styles.ability}`}>
          <span className={styles.abilityTag} title={ability.type}>
            특성
          </span>
          <MoveName move={ability} shown={name(ability)} />
          <p className={styles.moveText}>{text(ability)}</p>
        </div>
      ))}

      {attacks.map((attack) => {
        const cost = attack.cost.filter((type) => type !== 'Free')
        return (
          <div key={attack.name} className={styles.move}>
            <div className={styles.cost} aria-label={cost.length ? undefined : '에너지 없음'}>
              {cost.length ? cost.map((type, i) => <EnergyIcon key={i} type={type} />) : <span className={styles.free}>—</span>}
            </div>
            <MoveName move={attack} shown={name(attack)} />
            {attack.damage && <span className={styles.damage}>{attack.damage}</span>}
            {attack.text && <p className={styles.moveText}>{text(attack)}</p>}
          </div>
        )
      })}
    </section>
  )
}

/** The Korean name with the English one under it (the English stays searchable and checkable) */
function MoveName({ move, shown }: { move: { name: string; nameKo?: string }; shown: string }) {
  return (
    <h3 className={styles.moveName}>
      {shown}
      {shown !== move.name && <span className={styles.moveNameEn}>{move.name}</span>}
    </h3>
  )
}

/** "비공식 번역 · 원문 보기" — one switch for every card, remembered */
export function TextToggle({ original }: { original: boolean }) {
  return (
    <span className={styles.textToggle}>
      {original ? '영어 원문' : '비공식 번역'} ·{' '}
      <button type="button" aria-pressed={original} onClick={() => setOriginalText(!original)}>
        {original ? '한국어로 보기' : '원문 보기'}
      </button>
    </span>
  )
}
