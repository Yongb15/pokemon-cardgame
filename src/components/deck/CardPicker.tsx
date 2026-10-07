import { useEffect, useState } from 'react'
import { searchCards } from '../../api/cards'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { rememberCards } from '../../hooks/useDecks'
import { cleanName } from '../../lib/cardFilters'
import { formatCardNumber } from '../../lib/cardText'
import { DECK_SIZE, FORMATS, isBasicEnergy, MAX_COPIES, ruleName, type DeckFormat } from '../../lib/deck'
import type { CardListItem } from '../../types/card'
import CardImg from '../CardImg'
import SearchBar from '../SearchBar'
import styles from './deck.module.css'

const PAGE_SIZE = 24
const KINDS = [
  ['', '전체'],
  ['Pokémon', '포켓몬'],
  ['Trainer', '트레이너스'],
  ['Energy', '에너지'],
] as const

interface Props {
  format: DeckFormat
  counts: Map<string, number>
  nameCounts: Map<string, number>
  total: number
  onChange: (card: CardListItem, delta: 1 | -1) => void
}

interface Result {
  key: string
  cards: CardListItem[]
  totalCount: number
  page: number
  error: Error | null
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Search cards to add: name, card kind, and only cards legal in the deck's format */
export default function CardPicker({ format, counts, nameCounts, total, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const name = cleanName(useDebouncedValue(query, 300))
  const key = JSON.stringify([name, kind, format])
  const [result, setResult] = useState<Result | null>(null)
  const [reload, setReload] = useState(0)

  // New search terms start again from the first page
  const [lastKey, setLastKey] = useState(key)
  if (lastKey !== key) {
    setLastKey(key)
    setPage(1)
  }

  useEffect(() => {
    const controller = new AbortController()
    searchCards(
      {
        name: name || undefined,
        supertype: kind || undefined,
        format: format === 'unlimited' ? undefined : format,
        sort: 'newest',
        page,
        pageSize: PAGE_SIZE,
      },
      controller.signal,
    )
      .then((res) => {
        rememberCards(res.data)
        setResult((prev) => ({
          key,
          cards: page > 1 && prev?.key === key ? [...prev.cards, ...res.data] : res.data,
          totalCount: res.totalCount,
          page,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        // A failed "more" keeps what's already shown, so the button can retry that page
        setResult((prev) => {
          const same = prev?.key === key
          return { key, cards: same ? prev.cards : [], totalCount: same ? prev.totalCount : 0, page, error: error as Error }
        })
      })
    return () => controller.abort()
  }, [key, name, kind, format, page, reload])

  const current = result?.key === key ? result : null
  const loading = !current || (current.page !== page && !current.error)

  return (
    <div className={styles.picker}>
      <SearchBar value={query} onChange={setQuery} placeholder="덱에 넣을 카드 검색 (예: 리자몽, 이상한사탕)" />
      <div className={styles.kinds} role="group" aria-label="카드 종류">
        {KINDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={styles.kind}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={styles.pickerCount} role="status">
        {current && !current.error ? (
          <>
            검색 결과 <b>{current.totalCount.toLocaleString()}</b>장
            {format !== 'unlimited' && ` · ${FORMATS[format]}에서 쓸 수 있는 카드만`}
          </>
        ) : (
          ' '
        )}
      </p>

      {current?.error && !current.cards.length ? (
        <div className={styles.pickerError}>
          <p>카드를 불러오지 못했어요. {current.error.message}</p>
          <button type="button" className={styles.button} onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      ) : current && !current.cards.length ? (
        <p className={styles.pickerEmpty}>조건에 맞는 카드가 없어요.</p>
      ) : (
        <ul className={styles.tiles} aria-busy={loading || undefined}>
          {(current?.cards ?? []).map((card) => {
            const count = counts.get(card.id) ?? 0
            const atLimit =
              total >= DECK_SIZE || (!isBasicEnergy(card) && (nameCounts.get(ruleName(card.name)) ?? 0) >= MAX_COPIES)
            const label = card.nameKo ?? card.name
            return (
              <li key={card.id} className={styles.tile}>
                <div className={styles.tileImage}>
                  <CardImg
                    className={styles.tileImg}
                    src={card.images.small}
                    fallback={card.images.fallbackSmall}
                    alt=""
                    width={245}
                    height={342}
                    loading="lazy"
                    decoding="async"
                  />
                  {count > 0 && (
                    <span className={styles.badge} aria-label={`덱에 ${count}장`}>
                      {count}
                    </span>
                  )}
                </div>
                <p className={styles.tileName} title={card.nameKo ? `${card.nameKo} (${card.name})` : card.name}>
                  {label}
                </p>
                <p className={styles.tileSub}>
                  {card.set.nameKo} {formatCardNumber(card.number)}
                </p>
                <div className={styles.tileActions}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={!count}
                    onClick={() => onChange(card, -1)}
                    aria-label={`${label} 1장 빼기`}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.add}`}
                    disabled={atLimit}
                    onClick={() => onChange(card, 1)}
                    aria-label={`${label} 덱에 담기`}
                  >
                    + 담기
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {current && current.cards.length < current.totalCount && (
        <div className={styles.more}>
          {current.error && <p className={styles.pickerErrorText}>더 불러오지 못했어요. 다시 눌러 주세요.</p>}
          <button
            type="button"
            className={styles.button}
            disabled={loading}
            onClick={() => (current.error ? setReload((n) => n + 1) : setPage(current.page + 1))}
          >
            {loading ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}
    </div>
  )
}
