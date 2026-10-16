import { useEffect, useId, useRef, useState } from 'react'
import { cryptoInt, deal, expand, SIM_DECK, SIM_RUNS, type Odds, type Setup } from '../../lib/deckSim'
import type { DeckCard } from '../../lib/deck'
import type { CardListItem } from '../../types/card'
import CardImg from '../CardImg'
import styles from './DeckSimulator.module.css'

const isBasicPokemon = (card: CardListItem | undefined) => !!card && card.supertype === 'Pokémon' && !!card.subtypes?.includes('Basic')
const pct = (p: number) => `${(p * 100).toFixed(1)}%`

/** One card face, or its name while the image loads; text and our own image hosts only (Security D-5) */
function Face({ card, id }: { card: CardListItem | undefined; id: string }) {
  const name = card ? (card.nameKo ?? card.name) : id
  return (
    <li className={styles.card} title={name}>
      {card ? <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt={name} width={245} height={342} loading="lazy" /> : <span className={styles.back}>{name}</span>}
    </li>
  )
}

/**
 * "혼자 돌려 보기" (docs/deck/simulator.md §2): the setup of a game (shuffle, 7 cards with mulligans, 6 prizes)
 * and drawing, to practise with a deck. No game rules. The odds come from a worker so the tab never freezes.
 */
export default function DeckSimulator({ cards, info }: { cards: DeckCard[]; info: Map<string, CardListItem> }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const [game, setGame] = useState<(Setup & { drawn: string[]; shown: boolean }) | null>(null)
  const [target, setTarget] = useState('')
  const [result, setResult] = useState<{ key: string; odds: Odds | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  const ids = expand(cards)
  const deckKey = JSON.stringify(cards)
  const ready = ids.length === SIM_DECK
  const basics = [...new Set(ids)].filter((id) => isBasicPokemon(info.get(id)))
  const canStart = ready && basics.length > 0
  // A changed deck makes the hand and the odds stale
  const [lastKey, setLastKey] = useState(deckKey)
  if (lastKey !== deckKey) {
    setLastKey(deckKey)
    setGame(null)
    setResult(null)
  }

  const start = () => {
    const basic = new Set(basics)
    const setup = deal(ids, (id) => basic.has(id), cryptoInt)
    setGame(setup ? { ...setup, drawn: [], shown: false } : null)
  }
  const draw = () => setGame((g) => (g && g.library.length ? { ...g, library: g.library.slice(1), drawn: [...g.drawn, g.library[0]!] } : g))

  const runOdds = () => {
    if (busy || !canStart) return // a run at a time (Security D-4)
    setBusy(true)
    worker.current ??= new Worker(new URL('../../lib/deckSim.worker.ts', import.meta.url), { type: 'module' })
    const key = `${deckKey}|${target}`
    worker.current.onmessage = (event: MessageEvent<Odds | null>) => {
      setResult({ key, odds: event.data })
      setBusy(false)
    }
    worker.current.onerror = () => setBusy(false)
    worker.current.postMessage({ ids, basics, target: target || null })
  }
  const odds = result && result.key === `${deckKey}|${target}` ? result.odds : null
  const choices = cards.filter((c) => info.has(c.id))

  return (
    <section className={styles.sim} aria-label="혼자 돌려 보기">
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        혼자 돌려 보기
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {!ready ? (
          <p className={styles.note}>60장을 채우면 섞어서 첫 패를 뽑아 볼 수 있어요. (지금 {ids.length}장)</p>
        ) : !basics.length ? (
          <p className={styles.note}>기본 포켓몬이 없으면 게임을 시작할 수 없어요. 기본 포켓몬을 넣어 주세요.</p>
        ) : (
          <>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={start}>
                {game ? '다시 섞기' : '섞고 시작'}
              </button>
              <button type="button" className={styles.button} onClick={draw} disabled={!game || !game.library.length}>
                1장 뽑기
              </button>
            </div>

            {game && (
              <div className={styles.table}>
                <p className={styles.status} role="status">
                  멀리건 {game.mulligans}번 · 남은 덱 {game.library.length}장{game.drawn.length > 0 && ` · 뽑은 카드 ${game.drawn.length}장`}
                </p>
                <h3>패 {game.hand.length + game.drawn.length}장</h3>
                <ul className={styles.row}>
                  {[...game.hand, ...game.drawn].map((id, i) => (
                    <Face key={`${i}-${id}`} id={id} card={info.get(id)} />
                  ))}
                </ul>
                <h3>
                  프라이즈 6장{' '}
                  <button type="button" className={styles.link} onClick={() => setGame({ ...game, shown: !game.shown })} aria-pressed={game.shown}>
                    {game.shown ? '다시 덮기' : '뒤집어 보기'}
                  </button>
                </h3>
                <ul className={styles.row}>
                  {game.prizes.map((id, i) =>
                    game.shown ? (
                      <Face key={`${i}-${id}`} id={id} card={info.get(id)} />
                    ) : (
                      <li key={i} className={styles.card}>
                        <span className={styles.back} aria-label="뒷면 카드" />
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}

            <div className={styles.odds}>
              <h3>확률 (2만 번 섞어 세기)</h3>
              <label className={styles.pick}>
                <span>볼 카드</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">고르지 않음</option>
                  {choices.map((c) => {
                    const card = info.get(c.id)!
                    return (
                      <option key={c.id} value={c.id}>
                        {card.nameKo ?? card.name} ×{c.count}
                      </option>
                    )
                  })}
                </select>
              </label>
              <button type="button" className={styles.button} onClick={runOdds} disabled={busy}>
                {busy ? '세는 중…' : '확률 계산'}
              </button>
              {odds && (
                <dl className={styles.numbers}>
                  <div>
                    <dt>멀리건 없이 시작</dt>
                    <dd>{pct(odds.noMulligan)}</dd>
                  </div>
                  <div>
                    <dt>평균 멀리건</dt>
                    <dd>{odds.averageMulligans.toFixed(2)}번</dd>
                  </div>
                  {odds.target && (
                    <>
                      <div>
                        <dt>첫 패(7장)에 있음</dt>
                        <dd>{pct(odds.target.by7)}</dd>
                      </div>
                      <div>
                        <dt>첫 드로우까지(8장)</dt>
                        <dd>{pct(odds.target.by8)}</dd>
                      </div>
                      <div>
                        <dt>두 번째 드로우까지(9장)</dt>
                        <dd>{pct(odds.target.by9)}</dd>
                      </div>
                      <div>
                        <dt>전부 프라이즈에 깔림</dt>
                        <dd>{pct(odds.target.allPrized)}</dd>
                      </div>
                    </>
                  )}
                </dl>
              )}
              <p className={styles.note}>{SIM_RUNS.toLocaleString()}번 섞어 센 값이라 ±0.5%p 정도 차이가 날 수 있어요. 첫 패는 멀리건 뒤의 패(기본 포켓몬이 있는 패) 기준이라 일반 확률표보다 조금 낮게 나와요. 게임 규칙(기술·데미지)은 없고, 덱 점검용이에요.</p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
