import { formatDate, formatEur, formatUsd, PRICE_VARIANT_LABEL } from '../../lib/cardText'
import type { Card, TcgplayerPrice } from '../../types/card'
import styles from './detail.module.css'

const has = (value: number | null | undefined): value is number => typeof value === 'number' && value > 0

/** The first printing with a usable price, in the order TCGplayer lists them */
function pickTcgplayer(prices: Record<string, TcgplayerPrice> | undefined) {
  for (const [variant, price] of Object.entries(prices ?? {})) {
    if (has(price.market) || has(price.mid)) return { variant, price }
  }
  return null
}

export default function CardPrices({ card }: { card: Card }) {
  const tcg = pickTcgplayer(card.tcgplayer?.prices)
  const cm = card.cardmarket?.prices
  const hasCm = has(cm?.trendPrice) || has(cm?.lowPrice)
  if (!tcg && !hasCm) return null

  return (
    <section className={styles.section} aria-labelledby="price-heading">
      <h2 id="price-heading" className={styles.sectionTitle}>
        시세 <span className={styles.sectionNote}>참고용 · 해외 마켓 기준</span>
      </h2>
      <div className={styles.prices}>
        {tcg && card.tcgplayer && (
          <div className={styles.price}>
            <p className={styles.priceMarket}>
              TCGplayer · {PRICE_VARIANT_LABEL[tcg.variant] ?? tcg.variant}
            </p>
            <p className={styles.priceMain}>
              {formatUsd(has(tcg.price.market) ? tcg.price.market : tcg.price.mid!)}
              <small>{has(tcg.price.market) ? '시장가' : '중간가'}</small>
            </p>
            <p className={styles.priceRange}>
              {[
                has(tcg.price.low) && `최저 ${formatUsd(tcg.price.low)}`,
                has(tcg.price.mid) && `중간 ${formatUsd(tcg.price.mid)}`,
                has(tcg.price.high) && `최고 ${formatUsd(tcg.price.high)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className={styles.priceDate}>
              {formatDate(card.tcgplayer.updatedAt, 'short')} 업데이트 ·{' '}
              <a href={card.tcgplayer.url} target="_blank" rel="noreferrer">
                TCGplayer에서 보기 ↗
              </a>
            </p>
          </div>
        )}
        {hasCm && card.cardmarket && (
          <div className={styles.price}>
            <p className={styles.priceMarket}>Cardmarket</p>
            <p className={styles.priceMain}>
              {formatEur(has(cm?.trendPrice) ? cm.trendPrice : cm!.lowPrice!)}
              <small>{has(cm?.trendPrice) ? '추세가' : '최저가'}</small>
            </p>
            <p className={styles.priceRange}>
              {[has(cm?.lowPrice) && `최저 ${formatEur(cm.lowPrice)}`, has(cm?.avg30) && `30일 평균 ${formatEur(cm.avg30)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className={styles.priceDate}>
              {formatDate(card.cardmarket.updatedAt, 'short')} 업데이트 ·{' '}
              <a href={card.cardmarket.url} target="_blank" rel="noreferrer">
                Cardmarket에서 보기 ↗
              </a>
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
