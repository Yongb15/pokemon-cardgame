import { useEffect, useRef, useState } from 'react'
import { getCardPrices } from '../../api/cards'
import { useApiResource } from '../../hooks/useApiResource'
import type { CardPrices as Prices, EditionView, Price } from '../../types/prices'
import styles from './detail.module.css'
import p from './prices.module.css'

type Edition = 'en' | 'ja' | 'ko'
type Range = '30d' | '90d'

const EDITION_LABEL: Record<Edition, string> = { en: '영문판', ja: '일본판', ko: '한글판' }
const SOURCE_LABEL: Record<string, string> = { tcgplayer: 'TCGplayer 시장가', cardmarket: 'Cardmarket 추세가' }
const VARIANT_LABEL: Record<string, string> = {
  normal: '일반',
  holo: '홀로',
  reverse: '리버스 홀로',
  firstEdition: '1판',
  unlimited: '무제한판',
}
const CURRENCY: Record<string, (n: number) => string> = {
  USD: (n) => `US$${n.toFixed(2)}`,
  EUR: (n) => `€${n.toFixed(2)}`,
  JPY: (n) => `¥${Math.round(n).toLocaleString('ko-KR')}`,
}

/** More would make the box taller than its reserved height (qa P4-4) */
const MAX_OTHERS = 2

const label = (map: Record<string, string>, key: string) => (Object.hasOwn(map, key) ? map[key] : key)
const won = (krw: number) => `₩${krw.toLocaleString('ko-KR')}`
/** "2026-10-08" → "10.08" (prices are kept per UTC day) */
const shortDate = (day: string) => `${day.slice(5, 7)}.${day.slice(8, 10)}`

const amountText = (price: Price) =>
  Object.hasOwn(CURRENCY, price.currency) ? CURRENCY[price.currency](price.amount) : `${price.amount} ${price.currency}`

/** Won, "₩10 미만", or — with no exchange rate yet — the original amount (qa V-1) */
function priceText(price: Price) {
  return price.krw !== null ? won(price.krw) : price.belowMin ? '₩10 미만' : amountText(price)
}

function original(price: Price) {
  const detail = `${label(SOURCE_LABEL, price.source)} · ${label(VARIANT_LABEL, price.variant)}`
  // The headline already is the original amount when there's no rate: say why instead
  return price.krw === null && !price.belowMin ? `원화 환산 준비 중 · ${detail}` : `${amountText(price)} · ${detail}`
}

/** Whether an edition has prices to show over a period */
function hasPrices(data: Prices, edition: Edition) {
  if (edition === 'en') return !!data.editions.en.latest
  return edition === 'ja' && data.editions.ja.state === 'ok'
}

/** The edition to show first: the first one with prices (qa) */
function firstEdition(data: Prices): Edition {
  if (data.editions.en.latest) return 'en'
  if (data.editions.ja.state === 'ok') return 'ja'
  return 'en'
}

/**
 * A line chart of the daily won prices; unchecked days are drawn dashed (qa D-4). Cardmarket's
 * 30-day average is a faint level line, so even a first day's price has something to compare with.
 */
function PriceChart({ view, rangeDays, today }: { view: EditionView; rangeDays: number; today: string }) {
  const points = view.history.points.filter((pt) => pt.krw !== null) as { date: string; krw: number }[]
  const average = view.avg30?.krw ?? null
  // The chart's place is kept even without a line, so every state has the same height (qa: CLS)
  if (points.length < (average === null ? 2 : 1)) return <div className={p.chartEmpty} aria-hidden="true" />
  const W = 600
  const H = 120
  const PAD = 8
  const dayIndex = (day: string) => rangeDays - 1 - Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)
  // At least ±10% around the middle, so a 2% wobble doesn't look like a crash
  const levels = [...points.map((pt) => pt.krw), ...(average === null ? [] : [average])]
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const mid = (lo + hi) / 2
  const half = Math.max((hi - lo) / 2, mid * 0.1, 1)
  const min = mid - half
  const span = half * 2
  const x = (day: string) => PAD + (dayIndex(day) / Math.max(rangeDays - 1, 1)) * (W - PAD * 2)
  const y = (krw: number) => H - PAD - ((krw - min) / span) * (H - PAD * 2)

  // Solid runs of consecutive days; dashed links across the gaps
  const runs: { date: string; krw: number }[][] = []
  for (const pt of points) {
    const last = runs.at(-1)?.at(-1)
    if (last && Math.round((Date.parse(pt.date) - Date.parse(last.date)) / 86_400_000) === 1) runs.at(-1)!.push(pt)
    else runs.push([pt])
  }
  const path = (run: { date: string; krw: number }[]) =>
    run.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.date).toFixed(1)},${y(pt.krw).toFixed(1)}`).join(' ')

  return (
    <svg className={p.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {average !== null && (
        <line
          className={p.avgLine}
          x1={PAD}
          y1={y(average)}
          x2={W - PAD}
          y2={y(average)}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {runs.slice(1).map((run, i) => {
        const from = runs[i].at(-1)!
        const to = run[0]
        return (
          <line
            key={to.date}
            className={p.gapLine}
            x1={x(from.date)}
            y1={y(from.krw)}
            x2={x(to.date)}
            y2={y(to.krw)}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
      {runs.map((run) =>
        run.length > 1 ? (
          <path key={run[0].date} className={p.line} d={path(run)} vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key={run[0].date} className={p.dot} cx={x(run[0].date)} cy={y(run[0].krw)} r={3} />
        ),
      )}
    </svg>
  )
}

function EditionPrices({ view, data, rangeDays }: { view: EditionView; data: Prices; rangeDays: number }) {
  const latest = view.latest!
  const { summary, history } = view
  const refreshFailed = data.refresh.status === 'error'
  const fetching = data.refresh.status === 'pending' || data.refresh.refreshing
  return (
    <>
      <div className={p.headline}>
        <strong className={p.krw}>{priceText(latest)}</strong>
        <span className={p.original}>{original(latest)}</span>
      </div>
      <p className={p.dates}>
        시세 {shortDate(latest.date)}
        {latest.fxDate && ` · 환율 ${shortDate(latest.fxDate)}`} 기준
        {view.staleDays !== null && (
          <span className={p.stale}>
            {' · '}
            {view.staleDays}일 전 기준
            {fetching ? ' · 최신 시세를 가져오는 중이에요' : refreshFailed ? ' · 최신 정보를 가져오지 못했어요' : ''}
          </span>
        )}
      </p>
      {view.others.length > 0 && (
        <ul className={p.others} aria-label="다른 시세">
          {view.others.slice(0, MAX_OTHERS).map((o) => (
            <li key={`${o.source}:${o.variant}`}>
              <span className={p.othersLabel}>다른 시세</span> <b>{priceText(o)}</b> {original(o)}
            </li>
          ))}
          {view.others.length > MAX_OTHERS && (
            <li>
              {view.others
                .slice(MAX_OTHERS)
                .map((o) => `${label(VARIANT_LABEL, o.variant)} ${priceText(o)}`)
                .join(' · ')}
            </li>
          )}
        </ul>
      )}
      {data.mixedEditions && <p className={p.note}>1판·무제한판을 구분하지 않은 시세예요.</p>}

      <PriceChart view={view} rangeDays={rangeDays} today={data.today} />
      <p className={p.summary}>
        {summary && history.points.length > 1
          ? `최근 ${rangeDays}일 최저 ${won(summary.min)} · 최고 ${won(summary.max)}${
              summary.changePct !== null ? ` · 변동 ${summary.changePct > 0 ? '+' : ''}${summary.changePct}%` : ''
            }`
          : history.before
            ? `최근 ${rangeDays}일 동안 확인된 시세가 없어요 (마지막 ${history.before.krw !== null ? won(history.before.krw) : '-'}, ${shortDate(history.before.date)})`
            : view.avg30
              ? '우리 기록은 매일 하루치씩 쌓이는 중이에요.'
              : '그래프를 그릴 만큼 기록이 아직 쌓이지 않았어요.'}
        {view.avg30 && ` · 점(···) 선은 Cardmarket 최근 30일 평균 ${priceText(view.avg30)} (${amountText(view.avg30)})`}
        {history.gaps.length > 0 &&
          ` · ${history.gaps
            .slice(0, 2)
            .map((g) => (g.from === g.to ? shortDate(g.from) : `${shortDate(g.from)}–${shortDate(g.to)}`))
            .join(', ')}${history.gaps.length > 2 ? ' 외' : ''} 시세 확인 못 함(점선)`}
      </p>
      <p className={p.note}>원화 그래프는 환율 변동을 포함해요.</p>

      {history.points.length > 0 && (
        <details className={p.table}>
          <summary>날짜별 시세 표</summary>
          <table>
            <caption className={p.srOnly}>최근 {rangeDays}일 날짜별 원화 시세</caption>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">시세</th>
              </tr>
            </thead>
            <tbody>
              {[...history.points].reverse().map((pt) => (
                <tr key={pt.date}>
                  <td>{shortDate(pt.date)}</td>
                  <td>{pt.krw !== null ? won(pt.krw) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={p.empty}>{children}</p>
}

const NEW_WINDOW = (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={p.external}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
)

function Body({ data, edition, rangeDays }: { data: Prices; edition: Edition; rangeDays: number }) {
  const { en, ja, ko } = data.editions
  if (edition === 'en') {
    if (en.latest) return <EditionPrices view={en} data={data} rangeDays={rangeDays} />
    if (data.refresh.status === 'pending' || data.refresh.refreshing)
      return <Empty>시세를 가져오는 중이에요. 잠시 후 다시 확인해 주세요.</Empty>
    if (data.refresh.status === 'error') return <Empty>시세를 가져오지 못했어요. 잠시 후 다시 확인해 주세요.</Empty>
    return <Empty>아직 시세 정보가 없어요.</Empty>
  }
  if (edition === 'ja') {
    if (ja.state === 'ok') return <EditionPrices view={ja} data={data} rangeDays={rangeDays} />
    return (
      <Empty>
        {ja.state === 'absent'
          ? '일본판에는 없는 카드예요.'
          : ja.state === 'noPrice'
            ? '일본판 시세 정보가 아직 없어요.'
            : ja.state === 'checking'
              ? '일본판 카드와의 연결을 확인하고 있어요.'
              : '일본판 연결 정보가 아직 없어요.'}
      </Empty>
    )
  }
  return (
    <div className={p.korean}>
      <p>한글판 시세는 아직 없어요. 중고 거래 사이트에서 직접 찾아볼 수 있어요.</p>
      <div className={p.links}>
        <a href={ko.links.kream} target="_blank" rel="noopener noreferrer" aria-label={`크림에서 ${ko.links.term} 검색 (새 창)`}>
          크림에서 검색 {NEW_WINDOW}
        </a>
        <a href={ko.links.bunjang} target="_blank" rel="noopener noreferrer" aria-label={`번개장터에서 ${ko.links.term} 검색 (새 창)`}>
          번개장터에서 검색 {NEW_WINDOW}
        </a>
      </div>
      <p className={p.note}>검색어: {ko.links.term}</p>
    </div>
  )
}

/** Prices by edition (docs/price/design.md §5). The box keeps one height in every state (qa: CLS). */
export default function CardPrices({ cardId }: { cardId: string }) {
  const [range, setRange] = useState<Range>('30d')
  const [chosen, setChosen] = useState<{ card: string; edition: Edition } | null>(null)
  const resource = useApiResource(`prices:${cardId}:${range}`, (signal) => getCardPrices(cardId, range, signal))
  const data = resource.data

  // After "다시 시도" succeeds the button is gone: bring focus back to the section (qa P4-2)
  const heading = useRef<HTMLHeadingElement>(null)
  const retried = useRef(false)
  useEffect(() => {
    if (retried.current && resource.status === 'success') {
      retried.current = false
      heading.current?.focus()
    }
  }, [resource.status])

  if (data && 'hidden' in data) return null
  const rangeDays = range === '90d' ? 90 : 30
  const edition = chosen?.card === cardId ? chosen.edition : data ? firstEdition(data) : 'en'

  return (
    <section className={styles.section} aria-labelledby="price-heading">
      <h2 id="price-heading" className={styles.sectionTitle} ref={heading} tabIndex={-1}>
        시세 <span className={styles.sectionNote}>참고용 · 원화 환산</span>
      </h2>
      <div className={p.box} aria-busy={resource.status === 'loading' || undefined}>
        <div className={p.controls}>
          <div className={p.segments} role="group" aria-label="판본">
            {(['en', 'ja', 'ko'] as const).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={edition === e}
                onClick={() => setChosen({ card: cardId, edition: e })}
              >
                {EDITION_LABEL[e]}
              </button>
            ))}
          </div>
          {data && hasPrices(data, edition) && (
            <div className={p.segments} role="group" aria-label="기간">
              {(['30d', '90d'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r === '30d' ? '30일' : '90일'}
                </button>
              ))}
            </div>
          )}
        </div>

        {resource.status === 'error' ? (
          <div className={p.empty} role="alert">
            <p>시세를 불러오지 못했어요.</p>
            <button
              type="button"
              className={p.retry}
              onClick={() => {
                retried.current = true
                resource.retry()
              }}
            >
              다시 시도
            </button>
          </div>
        ) : !data ? (
          <div className={p.skeleton} aria-label="시세를 불러오는 중">
            <span style={{ width: '40%', height: 34 }} />
            <span style={{ width: '70%', height: 14 }} />
            <span style={{ width: '100%', height: 120, marginTop: 12 }} />
          </div>
        ) : (
          <Body data={data} edition={edition} rangeDays={rangeDays} />
        )}
      </div>
    </section>
  )
}
