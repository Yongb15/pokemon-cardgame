import { useId, useState } from 'react'
import type { DeckCard } from '../../lib/deck'
import { deckStats, STAGE_LABEL, STAGES, TRAINER_KINDS, TRAINER_LABEL } from '../../lib/deckStats'
import { TYPE_COLOR, TYPE_LABEL, TYPE_TEXT } from '../../lib/pokemonTypes'
import type { CardListItem } from '../../types/card'
import styles from './DeckStats.module.css'

const OPEN_KEY = 'card-dex:deck-stats-open'

function readOpen(fallback: boolean) {
  try {
    const value = localStorage.getItem(OPEN_KEY)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

const KINDS = [
  { key: 'pokemon', label: '포켓몬', color: 'var(--accent)' },
  { key: 'trainer', label: '트레이너스', color: '#2f8fe0' },
  { key: 'energy', label: '에너지', color: '#a1a1aa' },
] as const

/** Rows of label → count; zero rows are left out */
function Counts({ rows }: { rows: [string, number][] }) {
  const shown = rows.filter(([, n]) => n > 0)
  if (!shown.length) return null
  return (
    <dl className={styles.counts}>
      {shown.map(([label, n]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{n}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * "덱 구성" under the deck's progress bar (docs/design/deck-add-and-stats.webp ⑤): kinds, Pokémon
 * stages and types, Trainer kinds and Energy, counted from the cards whose details are loaded.
 * Folded or not is remembered in this browser; `defaultOpen` is the first-time state.
 */
export default function DeckStats({ cards, info, defaultOpen = true }: { cards: DeckCard[]; info: Map<string, CardListItem>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => readOpen(defaultOpen))
  const bodyId = useId()
  const s = deckStats(cards, info)
  const total = s.pokemon + s.trainer + s.energy
  if (!total) return null

  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    } catch {
      // not remembered; the toggle still works
    }
  }

  return (
    <section className={styles.stats} aria-label="덱 구성">
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        덱 구성
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {/* Kept in the DOM while folded, so aria-controls always points somewhere (qa) */}
      <div id={bodyId} className={styles.body} hidden={!open}>
        <div className={styles.section}>
          <h3>종류</h3>
          <div className={styles.stack} aria-hidden="true">
            {KINDS.map(({ key, color }) => s[key] > 0 && <i key={key} style={{ flexGrow: s[key], background: color }} />)}
          </div>
          <ul className={styles.legend}>
            {KINDS.filter(({ key }) => s[key] > 0).map(({ key, label, color }) => (
              <li key={key}>
                <i style={{ background: color }} aria-hidden="true" />
                {label} <b>{s[key]}</b>
              </li>
            ))}
          </ul>
        </div>

        {s.pokemon > 0 && (
          <div className={styles.section}>
            <h3>포켓몬 {s.pokemon}</h3>
            <Counts rows={[...STAGES.map((st): [string, number] => [STAGE_LABEL[st], s.stages[st]]), ['규칙 카드 (ex·V·찬란한 등)', s.ruleBox]]} />
            <ul className={styles.types} aria-label="타입별">
              {s.types.map(({ type, count }) => (
                <li key={type} style={{ background: TYPE_COLOR[type], color: TYPE_TEXT[type] }}>
                  {TYPE_LABEL[type]} {count}
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.trainer > 0 && (
          <div className={styles.section}>
            <h3>트레이너스 {s.trainer}</h3>
            <Counts rows={TRAINER_KINDS.map((k): [string, number] => [TRAINER_LABEL[k], s.trainers[k]])} />
          </div>
        )}

        {s.energy > 0 && (
          <div className={styles.section}>
            <h3>에너지 {s.energy}</h3>
            <Counts rows={[...s.basicEnergy.map(({ name, count }): [string, number] => [name, count]), ['특수 에너지', s.specialEnergy]]} />
          </div>
        )}
        {total < cards.reduce((n, c) => n + c.count, 0) && <p className={styles.note}>정보를 불러오지 못한 카드는 빼고 셌어요.</p>}
      </div>
    </section>
  )
}
