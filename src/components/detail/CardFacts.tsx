import { Link } from 'react-router'
import { formatDate, LEGALITY_FORMAT_LABEL } from '../../lib/cardText'
import type { Card } from '../../types/card'
import CardImg from '../CardImg'
import EnergyIcon from '../EnergyIcon'
import styles from './detail.module.css'

/** Rules box (ex rule, or the effect text of a Trainer/Energy) */
export function CardRules({ card }: { card: Card }) {
  if (!card.rules?.length) return null
  const isPokemon = card.supertype === 'Pokémon'
  return (
    <div className={styles.rules}>
      <b>{isPokemon ? '특수 룰' : '카드 효과'}</b>
      {card.rules.map((rule) => (
        <p key={rule}>{rule}</p>
      ))}
    </div>
  )
}

/** Weakness / resistance / retreat — only Pokémon have these */
export function BattleStats({ card }: { card: Card }) {
  if (card.supertype !== 'Pokémon') return null
  const none = <span className={styles.statNone}>없음</span>
  return (
    <dl className={styles.stats}>
      <div>
        <dt>약점</dt>
        <dd>
          {card.weaknesses?.length
            ? card.weaknesses.map((w) => (
                <span key={w.type} className={styles.statItem}>
                  <EnergyIcon type={w.type} size={18} /> {w.value}
                </span>
              ))
            : none}
        </dd>
      </div>
      <div>
        <dt>저항력</dt>
        <dd>
          {card.resistances?.length
            ? card.resistances.map((r) => (
                <span key={r.type} className={styles.statItem}>
                  <EnergyIcon type={r.type} size={18} /> {r.value}
                </span>
              ))
            : none}
        </dd>
      </div>
      <div>
        <dt>후퇴</dt>
        <dd aria-label={`후퇴 에너지 ${card.retreatCost?.length ?? 0}개`}>
          {card.retreatCost?.length ? card.retreatCost.map((type, i) => <EnergyIcon key={i} type={type} size={18} />) : none}
        </dd>
      </div>
    </dl>
  )
}

/** Set, number, rarity, release date, artist, Pokédex number, regulation mark, legality */
export function CardInfo({ card }: { card: Card }) {
  const total = card.set.printedTotal ?? card.set.total
  const dex = card.nationalPokedexNumbers?.[0]
  const legal = (Object.keys(LEGALITY_FORMAT_LABEL) as (keyof typeof LEGALITY_FORMAT_LABEL)[]).filter(
    (format) => card.legalities?.[format],
  )

  return (
    <section className={styles.section} aria-labelledby="info-heading">
      <h2 id="info-heading" className={styles.sectionTitle}>
        카드 정보
      </h2>
      <div className={styles.setBox}>
        <CardImg
          className={styles.setLogo}
          src={card.set.images.logo}
          fallback={card.set.images.fallbackLogo}
          alt={`${card.set.name} 로고`}
          loading="lazy"
        />
        <dl className={styles.facts}>
          <dt>세트</dt>
          <dd>
            <CardImg className={styles.setSymbol} src={card.set.images.symbol} fallback={card.set.images.fallbackSymbol} alt="" />
            <Link to={`/?set=${encodeURIComponent(card.set.id)}`}>{card.set.name}</Link>
            <span className={styles.muted}>· {card.set.series}</span>
          </dd>
          <dt>번호</dt>
          <dd>
            {card.number}
            {total ? ` / ${total}` : ''}
          </dd>
          {card.rarity && (
            <>
              <dt>희귀도</dt>
              <dd className={/rare|legend/i.test(card.rarity) ? styles.rare : undefined}>{card.rarity}</dd>
            </>
          )}
          <dt>발매일</dt>
          <dd>{formatDate(card.set.releaseDate)}</dd>
          {card.artist && (
            <>
              <dt>일러스트</dt>
              <dd>{card.artist}</dd>
            </>
          )}
          {dex && (
            <>
              <dt>도감 번호</dt>
              <dd>No. {String(dex).padStart(4, '0')}</dd>
            </>
          )}
          {card.regulationMark && (
            <>
              <dt>레귤레이션</dt>
              <dd>
                <span className={styles.mark}>{card.regulationMark}</span>
              </dd>
            </>
          )}
        </dl>
      </div>

      {legal.length > 0 && (
        <ul className={styles.legal} aria-label="대회 사용 가능 여부">
          {legal.map((format) => {
            const ok = card.legalities?.[format] === 'Legal'
            return (
              <li key={format} className={ok ? styles.legalOk : styles.legalBanned}>
                {LEGALITY_FORMAT_LABEL[format]} {ok ? '사용 가능' : '사용 금지'}
              </li>
            )
          })}
        </ul>
      )}

      {card.flavorText && <p className={styles.flavor}>“{card.flavorText}”</p>}
    </section>
  )
}
