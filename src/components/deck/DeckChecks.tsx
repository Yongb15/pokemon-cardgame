import type { RuleCheck } from '../../lib/deck'
import styles from './deck.module.css'

/** The deck-rule checklist: problems first, then what already passes */
export default function DeckChecks({ checks }: { checks: RuleCheck[] }) {
  const sorted = [...checks.filter((c) => !c.ok), ...checks.filter((c) => c.ok)]
  return (
    <ul className={styles.checks} aria-label="덱 규칙 검사">
      {sorted.map((check, i) => (
        <li key={i} className={check.ok ? styles.ok : styles.bad}>
          <span className="visually-hidden">{check.ok ? '통과: ' : '문제: '}</span>
          {check.lead}
          {check.strong && <b>{check.strong}</b>}
          {check.rest}
        </li>
      ))}
    </ul>
  )
}
