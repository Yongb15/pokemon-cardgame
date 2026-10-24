import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { OpenedPack, PackTier } from '../api/account'
import { useCardInfo } from '../hooks/useDecks'
import { TIER_LABEL } from '../lib/packs'
import CardImg from './CardImg'
import styles from './TenPackResult.module.css'

/** Highest first: the order the 50 cards are shown in */
const TIER_RANK: PackTier[] = ['hyper', 'sir', 'ultra', 'illustration', 'double', 'rare', 'uncommon', 'common']

/**
 * Ten packs' 50 cards at once (docs/auction/exchange.md §1), best first. The guaranteed card (the tenth pack's
 * rare slot, when the first nine had no ultra or better) says so. `packs` null: opening right now.
 */
export default function TenPackResult({ packs, guaranteed }: { packs: OpenedPack[] | null; guaranteed: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const cards = (packs ?? []).flatMap((p, i) => p.cards.map((c, j) => ({ ...c, key: `${i}-${j}`, guarantee: guaranteed && i === 9 && c.rareSlot })))
  const { info } = useCardInfo(cards.map((c) => c.cardId))
  const sorted = [...cards].sort((a, b) => TIER_RANK.indexOf(a.tier) - TIER_RANK.indexOf(b.tier) || Number(b.isNew) - Number(a.isNew))
  const fresh = cards.filter((c) => c.isNew).length

  useEffect(() => {
    if (packs) heading.current?.focus()
  }, [packs])

  return (
    <section className={styles.result} aria-labelledby="ten-result">
      <h2 id="ten-result" ref={heading} tabIndex={-1}>
        {packs ? `10팩 결과 · 50장 (새 카드 ${fresh}장)` : '10팩 여는 중…'}
      </h2>
      {/* The grid keeps its 50 slots while opening, so nothing below moves when the cards land (CLS) */}
      <ol className={styles.grid} aria-busy={!packs || undefined}>
        {(packs ? sorted : Array.from({ length: 50 }, (_, i) => ({ key: String(i), cardId: '', tier: 'common' as PackTier, isNew: false, guarantee: false, rareSlot: false }))).map((c) => {
          const card = info.get(c.cardId)
          const name = card ? (card.nameKo ?? card.name) : c.cardId
          return (
            <li key={c.key} className={styles.cell}>
              {packs ? (
                <Link to={`/cards/${encodeURIComponent(c.cardId)}`} className={styles.face} title={`${name} · ${TIER_LABEL[c.tier]}`}>
                  {card ? <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt={`${name}, ${TIER_LABEL[c.tier]}`} width={245} height={342} loading="lazy" /> : <span className={styles.name}>{name}</span>}
                  {c.isNew && <span className={styles.newBadge}>새 카드</span>}
                  {c.guarantee && <span className={styles.guaranteeBadge}>보장</span>}
                </Link>
              ) : (
                <span className={styles.back} />
              )}
              <span className={styles.tier}>{packs ? TIER_LABEL[c.tier] : ' '}</span>
            </li>
          )
        })}
      </ol>
      <p className="visually-hidden" role="status">
        {packs ? `10팩을 열었어요. 50장 중 새 카드 ${fresh}장${guaranteed ? ', 보장으로 울트라 레어 이상 1장' : ''}.` : ''}
      </p>
      <p className={styles.foot}>
        50장을 내 컬렉션에 넣었어요.{' '}
        <Link to="/collection">컬렉션 보기</Link>
      </p>
    </section>
  )
}
