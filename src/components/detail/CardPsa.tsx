import type { PsaView } from '../../types/prices'
import styles from './detail.module.css'
import s from './CardPsa.module.css'

const GRADE_LABEL: Record<string, string> = { psa10: 'PSA 10', psa9: 'PSA 9', psa8: 'PSA 8' }
const GRADE_COLOR: Record<string, string> = { psa10: '#c99312', psa9: '#71717a', psa8: '#a1a1aa' }
const SOURCE = 'https://www.pokemonpricetracker.com'

const label = (grade: string) => (Object.hasOwn(GRADE_LABEL, grade) ? GRADE_LABEL[grade] : grade)
const color = (grade: string) => (Object.hasOwn(GRADE_COLOR, grade) ? GRADE_COLOR[grade] : '#a1a1aa')
const won = (krw: number) => `₩${krw.toLocaleString('ko-KR')}`
const usd = (n: number) => `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** "2026-10-08" → "10월 8일" */
const day = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`

type History = Extract<PsaView, { state: 'ok' }>['history']

/** Each grade's medians over the collections (weekly), once a grade has two points */
function Chart({ history }: { history: History }) {
  const lines = history.filter((h) => h.points.length >= 2)
  if (!lines.length) return null
  const dates = [...new Set(history.flatMap((h) => h.points.map((p) => p.date)))].sort()
  const values = lines.flatMap((h) => h.points.map((p) => p.usd))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (date: string) => (dates.length > 1 ? (dates.indexOf(date) / (dates.length - 1)) * 600 : 300)
  const y = (v: number) => (max === min ? 40 : 76 - ((v - min) / (max - min)) * 72)
  return (
    <figure className={s.chart}>
      <svg viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label={`등급별 중앙값 추이, ${day(dates[0]!)}부터 ${day(dates.at(-1)!)}까지`}>
        {lines.map((h) => (
          <polyline
            key={h.grade}
            fill="none"
            stroke={color(h.grade)}
            strokeWidth={h.grade === 'psa10' ? 2.5 : 2}
            vectorEffect="non-scaling-stroke"
            points={h.points.map((p) => `${x(p.date)},${y(p.usd)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption className={s.legend}>
        {lines.map((h) => (
          <span key={h.grade}>
            <i style={{ background: color(h.grade) }} aria-hidden="true" />
            {label(h.grade)}
          </span>
        ))}
        <span className={s.range}>
          {usd(min)} ~ {usd(max)} · 주 단위
        </span>
      </figcaption>
    </figure>
  )
}

/**
 * "PSA 등급 시세" under the price box (docs/design/psa-prices.webp ①②): the latest PSA 10/9/8
 * medians from Pokemon Price Tracker's sale records, in won and dollars (docs/price/psa.md).
 */
export default function CardPsa({ psa }: { psa: PsaView }) {
  return (
    <section className={styles.section} aria-labelledby="psa-heading">
      <h2 id="psa-heading" className={styles.sectionTitle}>
        PSA 등급 시세
        {psa.state === 'ok' && <span className={styles.sectionNote}>{day(psa.capturedOn)} 수집 · 주 1회 갱신</span>}
      </h2>
      <div className={s.box}>
        {psa.state === 'untracked' ? (
          <p className={s.note}>PSA 시세는 TCGplayer 시세 ${psa.minUsd} 이상인 카드만 모아요(약 300장, 주 1회).</p>
        ) : psa.state === 'pending' ? (
          <p className={s.note}>PSA 판매 기록을 모으는 중이에요. 주 1회 갱신돼요.</p>
        ) : (
          <>
            {psa.grades.length ? (
              <ul className={s.grades}>
                {psa.grades.map((g) => (
                  <li key={g.grade} className={g.grade === 'psa10' ? s.top : undefined}>
                    <span className={s.grade}>{label(g.grade)}</span>
                    <b>{g.krw !== null ? won(g.krw) : usd(g.usd)}</b>
                    <small>
                      {g.krw !== null && `${usd(g.usd)} · `}판매 {g.sales.toLocaleString('ko-KR')}건
                    </small>
                    {g.lastSaleOn && <small>마지막 판매 {day(g.lastSaleOn)}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.note}>최근 판매가 3건 이상인 등급이 없어요.</p>
            )}
            {psa.grades.length > 0 && psa.grades.length < 3 && <p className={s.note}>판매가 3건 미만인 등급은 보여 주지 않아요.</p>}
            <Chart history={psa.history} />
            <p className={s.note}>
              등급별 판매가 <b>중앙값</b>이에요(eBay·Fanatics 실제 판매 기준, 참고용). 출처:{' '}
              <a href={SOURCE} target="_blank" rel="noopener noreferrer">
                Pokemon Price Tracker
              </a>
            </p>
          </>
        )}
      </div>
    </section>
  )
}
