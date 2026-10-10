import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import CardImg from '../components/CardImg'
import Select from '../components/Select'
import bundledSets from '../data/sets.json'
import { useCardInfo } from '../hooks/useDecks'
import { formatCardNumber, rarityLabel } from '../lib/cardText'
import type { CardSet } from '../types/card'
import styles from './PricesPage.module.css'

type Edition = 'en' | 'ja' | 'psa10'

interface Ranked {
  id: string
  krw: number
  amount: number
  currency: string
  source: string
  variant: string
  date: string
  sales?: number
}

interface TopResponse {
  today: string
  cards: Ranked[]
}

const EDITIONS: [Edition, string][] = [
  ['en', '영문판'],
  ['ja', '일본판'],
  ['psa10', 'PSA 10'],
]
const SOURCE_LABEL: Record<string, string> = { tcgplayer: 'TCGplayer', cardmarket: 'Cardmarket' }
const VARIANT_LABEL: Record<string, string> = { normal: '일반', holo: '홀로', reverse: '리버스 홀로', firstEdition: '1판', unlimited: '무제한판' }
const CURRENCY: Record<string, (n: number) => string> = {
  USD: (n) => `US$${n.toFixed(2)}`,
  EUR: (n) => `€${n.toFixed(2)}`,
}
const label = (map: Record<string, string>, key: string) => (Object.hasOwn(map, key) ? map[key] : key)
const won = (krw: number) => `₩${krw.toLocaleString('ko-KR')}`
const shortDate = (day: string) => `${day.slice(5, 7)}.${day.slice(8, 10)}`

const SETS: CardSet[] = bundledSets
function groupBySeries(sets: CardSet[]) {
  const groups = new Map<string, CardSet[]>()
  for (const set of sets) groups.set(set.seriesKo, [...(groups.get(set.seriesKo) ?? []), set])
  return [...groups]
}

/**
 * /prices?edition=en|ja|psa10&set=… (docs/design/price-ranking.webp, psa-prices.webp ③): the priciest
 * cards right now
 */
export default function PricesPage() {
  const [params, setParams] = useSearchParams()
  const rawEdition = params.get('edition')
  const edition: Edition = rawEdition === 'ja' || rawEdition === 'psa10' ? rawEdition : 'en'
  const setParam = params.get('set') ?? ''
  const set = SETS.some((s) => s.id === setParam) ? setParam : ''
  const key = `${edition}|${set}`
  const unknownSet = setParam !== '' && !set

  // A value the page can't use (?edition=ko, a set that doesn't exist) is taken out of the address,
  // so a shared link shows what this page showed (qa P-4)
  const tidy = (rawEdition !== null && rawEdition !== edition) || unknownSet
  const [missingSet, setMissingSet] = useState(false)
  useEffect(() => {
    if (!tidy) return
    const query = new URLSearchParams()
    if (edition !== 'en') query.set('edition', edition)
    if (set) query.set('set', set)
    setParams(query, { replace: true })
  }, [tidy, edition, set, setParams])
  if (unknownSet && !missingSet) setMissingSet(true)
  const [result, setResult] = useState<{ key: string; data?: TopResponse; error?: boolean } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    document.title = '시세 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ edition, ...(set && { set }) })
    fetch(`/api/prices/top?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        setResult({ key, data: (await res.json()) as TopResponse })
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResult({ key, error: true })
      })
    return () => controller.abort()
  }, [key, edition, set, reload])

  const current = result?.key === key ? result : null
  const ranked = useMemo(() => current?.data?.cards ?? [], [current])
  const ids = useMemo(() => ranked.map((r) => r.id), [ranked])
  const { info } = useCardInfo(ids)

  const update = (next: { edition?: Edition; set?: string }) => {
    const query = new URLSearchParams()
    const e = next.edition ?? edition
    const s = next.set ?? set
    if (e !== 'en') query.set('edition', e)
    if (s) query.set('set', s)
    setParams(query, { replace: true })
    setMissingSet(false)
  }

  return (
    <main className={styles.main}>
      <div>
        <h1 className={styles.title}>시세</h1>
        <p className={styles.subtitle}>
          지금 가장 비싼 카드 · 시세를 모은 카드 기준(스탠다드는 매일, 나머지는 누군가 본 카드)
          {current?.data && ` · ${shortDate(current.data.today)} 기준`}
        </p>
      </div>

      <div className={styles.controls}>
        <div className={styles.segments} role="group" aria-label="판">
          {EDITIONS.map(([value, text]) => (
            <button key={value} type="button" aria-pressed={edition === value} className={styles.segment} onClick={() => update({ edition: value })}>
              {text}
            </button>
          ))}
        </div>
        <Select id="prices-set" label="세트" value={set} onChange={(value) => update({ set: value })}>
          <option value="">전체 세트</option>
          {groupBySeries(SETS).map(([series, list]) => (
            <optgroup key={series} label={series}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameKo}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <p className={styles.note}>
          {edition === 'en'
            ? 'TCGplayer 시장가(없으면 Cardmarket)'
            : edition === 'ja'
              ? 'Cardmarket 추세가 · 일본판과 연결된 카드만'
              : 'PSA 10 판매가 중앙값 · TCGplayer $50 이상 카드 약 300장, 주 1회'}{' '}
          · 원화 환산
          {edition === 'psa10' && (
            <>
              {' '}
              · 출처{' '}
              <a href="https://www.pokemonpricetracker.com" target="_blank" rel="noopener noreferrer">
                Pokemon Price Tracker
              </a>
            </>
          )}
        </p>
      </div>

      {missingSet && (
        <p className={styles.alert} role="status">
          없는 세트라 전체 세트를 보여 드려요.
        </p>
      )}

      {current?.error ? (
        <p className={styles.alert} role="alert">
          시세를 불러오지 못했어요.{' '}
          <button type="button" className={styles.linkButton} onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </p>
      ) : !current ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="시세를 불러오는 중" />
      ) : ranked.length === 0 ? (
        <div className={styles.empty}>
          <h2>{set ? '이 세트는 아직 모은 시세가 없어요' : '아직 모은 시세가 없어요'}</h2>
          <p>{edition === 'psa10' ? 'PSA 시세는 비싼 카드부터 주 1회 모아요.' : '카드 상세를 열면 그 카드의 시세를 가져와요.'}</p>
        </div>
      ) : (
        <ol className={styles.list}>
          {ranked.map((r, i) => {
            const card = info.get(r.id)
            const name = card ? (card.nameKo ?? card.name) : r.id
            return (
              <li key={r.id}>
                <Link className={styles.row} to={`/cards/${encodeURIComponent(r.id)}`}>
                  <span className={i < 3 ? `${styles.rank} ${styles.top}` : styles.rank} aria-label={`${i + 1}위`}>
                    {i + 1}
                  </span>
                  {card ? (
                    <CardImg
                      className={styles.thumb}
                      src={card.images.small}
                      fallback={card.images.fallbackSmall}
                      alt=""
                      width={245}
                      height={342}
                      loading={i < 8 ? 'eager' : 'lazy'}
                    />
                  ) : (
                    <span className={styles.thumb} aria-hidden="true" />
                  )}
                  <span className={styles.meta}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.sub}>
                      {card
                        ? [formatCardNumber(card.number), card.set.nameKo, card.rarity && rarityLabel(card.rarity)].filter(Boolean).join(' · ')
                        : ' '}
                    </span>
                  </span>
                  <span className={styles.price}>
                    <b>{won(r.krw)}</b>
                    <span>
                      {(Object.hasOwn(CURRENCY, r.currency) ? CURRENCY[r.currency](r.amount) : `${r.amount} ${r.currency}`) +
                        (r.source === 'psa10'
                          ? ` · PSA 10 · 판매 ${(r.sales ?? 0).toLocaleString('ko-KR')}건`
                          : ` · ${label(SOURCE_LABEL, r.source)} ${label(VARIANT_LABEL, r.variant)}`)}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </main>
  )
}
