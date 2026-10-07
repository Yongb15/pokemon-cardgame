import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import CardPicker from '../components/deck/CardPicker'
import DeckCardList from '../components/deck/DeckCardList'
import DeckChecks from '../components/deck/DeckChecks'
import ExportDialog from '../components/deck/ExportDialog'
import { NotFoundState } from '../components/ListStates'
import { useCardInfo, useDecks } from '../hooks/useDecks'
import { useMediaQuery } from '../hooks/useMediaQuery'
import {
  checkDeck,
  cleanDeckName,
  copiesByName,
  DECK_SIZE,
  deckSize,
  deleteDeck,
  exportDeckList,
  FORMATS,
  isDeckFormat,
  MAX_DECK_NAME,
  MAX_SHARE_QUERY,
  problemCount,
  putDeck,
  shareParams,
  type Deck,
} from '../lib/deck'
import type { CardListItem } from '../types/card'
import styles from './DeckPages.module.css'

export default function DeckEditorPage() {
  const { deckId } = useParams()
  const decks = useDecks()
  const deck = decks.find((d) => d.id === deckId)

  useEffect(() => {
    document.title = `${deck?.name ?? '덱을 찾을 수 없어요'} · Pokémon Card Dex`
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [deck?.name])

  if (!deck) {
    return (
      <main className={styles.main}>
        <meta name="robots" content="noindex" />
        <NotFoundState
          title="덱을 찾을 수 없어요"
          description={
            <>
              이 브라우저에 저장된 덱이 아니거나 삭제됐어요.
              <br />
              <Link to="/decks">내 덱 목록으로</Link>
            </>
          }
        />
      </main>
    )
  }
  return <Editor key={deck.id} deck={deck} />
}

function Editor({ deck }: { deck: Deck }) {
  const navigate = useNavigate()
  const isNarrow = useMediaQuery('(max-width: 900px)')
  const [tab, setTab] = useState<'cards' | 'deck'>('cards')
  const [name, setName] = useState(deck.name)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const ids = useMemo(() => deck.cards.map((c) => c.id), [deck.cards])
  const { info, loading, error, unknownIds } = useCardInfo(ids)
  const total = deckSize(deck.cards)
  const checks = checkDeck(deck.cards, deck.format, info)
  const problems = problemCount(checks)
  const counts = useMemo(() => new Map(deck.cards.map((c) => [c.id, c.count])), [deck.cards])
  const nameCounts = copiesByName(deck.cards, info)

  function save(next: Partial<Deck>) {
    try {
      putDeck({ ...deck, ...next })
    } catch {
      setNotice({ kind: 'error', text: '브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.' })
    }
  }

  // Remember the cover and rule status for the deck list, once every card's details are in
  const coverId = deck.cards.find((c) => info.get(c.id)?.supertype === 'Pokémon')?.id ?? deck.cards[0]?.id
  useEffect(() => {
    if (loading || error) return
    if (deck.coverId === coverId && deck.problems === problems) return
    try {
      putDeck({ ...deck, coverId, problems })
    } catch {
      // only list-page extras; an edit that can't be saved already shows the storage error
    }
  })

  function change(card: CardListItem, delta: 1 | -1) {
    const current = counts.get(card.id) ?? 0
    const next = current + delta
    const cards =
      next <= 0
        ? deck.cards.filter((c) => c.id !== card.id)
        : current === 0
          ? [...deck.cards, { id: card.id, count: next }]
          : deck.cards.map((c) => (c.id === card.id ? { ...c, count: next } : c))
    save({ cards })
  }

  async function copyShareLink() {
    const params = shareParams({ name: deck.name, format: deck.format, cards: deck.cards })
    if (params.toString().length > MAX_SHARE_QUERY) {
      setNotice({ kind: 'error', text: '덱이 너무 커서 링크로 만들 수 없어요.' })
      return
    }
    const url = `${window.location.origin}/decks/shared?${params}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ kind: 'ok', text: '공유 링크를 복사했어요.' })
    } catch {
      setNotice({ kind: 'error', text: `복사하지 못했어요. 이 주소를 직접 복사해 주세요: ${url}` })
    }
  }

  function remove() {
    if (!window.confirm(`“${deck.name}” 덱을 삭제할까요? 되돌릴 수 없어요.`)) return
    try {
      deleteDeck(deck.id)
      // The list page moves focus to its heading, so keyboard users don't land on <body>
      navigate('/decks', { replace: true, state: { focusHeading: true } })
    } catch {
      setNotice({ kind: 'error', text: '삭제하지 못했어요. 브라우저 저장소를 사용할 수 없어요.' })
    }
  }

  const panel = (
    <aside className={isNarrow ? `${styles.deckPanel} ${styles.flat}` : styles.deckPanel} aria-label="덱">
      <div className={styles.nameRow}>
        <label htmlFor="deck-name" className="visually-hidden">
          덱 이름
        </label>
        <input
          id="deck-name"
          className={styles.nameInput}
          value={name}
          maxLength={MAX_DECK_NAME}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const clean = cleanDeckName(name) || deck.name
            setName(clean)
            if (clean !== deck.name) save({ name: clean })
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>

      <div className={styles.segments} role="radiogroup" aria-label="포맷">
        {Object.entries(FORMATS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={deck.format === value}
            className={styles.segment}
            onClick={() => isDeckFormat(value) && save({ format: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.progress}>
        <p>
          <b>{total}</b> / {DECK_SIZE}
        </p>
        <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={DECK_SIZE} aria-valuenow={total} aria-label="덱 장수">
          <i style={{ width: `${Math.min(100, (total / DECK_SIZE) * 100)}%` }} />
        </div>
      </div>

      {error ? (
        <p className={styles.alert} role="alert">
          카드 정보를 불러오지 못해 규칙을 확인할 수 없어요. {error.message}
        </p>
      ) : loading ? (
        <p className={styles.muted}>카드 정보를 불러오는 중…</p>
      ) : (
        <DeckChecks checks={checks} />
      )}
      {unknownIds.length > 0 && (
        <p className={styles.alert}>
          더 이상 데이터에 없는 카드 {unknownIds.length}종이 덱에 있어요.{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => save({ cards: deck.cards.filter((c) => !unknownIds.includes(c.id)) })}
          >
            빼기
          </button>
        </p>
      )}

      {total > 0 ? (
        <DeckCardList cards={deck.cards} info={info} nameCounts={nameCounts} onChange={change} />
      ) : (
        <p className={styles.muted}>왼쪽에서 카드를 검색해 “+ 담기”를 눌러 보세요.</p>
      )}

      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.alert} role="status">
          {notice.text}
        </p>
      )}
      <div className={styles.panelActions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={copyShareLink} disabled={!total}>
          공유 링크 복사
        </button>
        <button type="button" className={styles.button} onClick={() => setExporting(true)} disabled={!total || loading}>
          PTCG Live로 내보내기
        </button>
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={remove}>
          삭제
        </button>
      </div>
    </aside>
  )

  const picker = <CardPicker format={deck.format} counts={counts} nameCounts={nameCounts} total={total} onChange={change} />

  return (
    <main className={styles.main}>
      <Link to="/decks" className={styles.back}>
        ← 내 덱
      </Link>
      <h1 className="visually-hidden">{deck.name} 편집</h1>
      {isNarrow ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="덱 편집">
            <button type="button" role="tab" aria-selected={tab === 'cards'} onClick={() => setTab('cards')}>
              카드 찾기
            </button>
            <button type="button" role="tab" aria-selected={tab === 'deck'} onClick={() => setTab('deck')}>
              덱 <span className={styles.tabCount}>{total}</span>
            </button>
          </div>
          {/* Both stay mounted so the search and its results survive switching tabs */}
          <div role="tabpanel" hidden={tab !== 'cards'}>
            {picker}
          </div>
          <div role="tabpanel" hidden={tab !== 'deck'}>
            {panel}
          </div>
          {tab === 'cards' && (
            <div className={styles.bottomBar}>
              <div className={styles.progress}>
                <p>
                  <b>{total}</b> / {DECK_SIZE}
                  {!loading && problems > 0 && <span className={styles.bottomProblems}> · 문제 {problems}개</span>}
                </p>
                <div className={styles.bar} aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (total / DECK_SIZE) * 100)}%` }} />
                </div>
              </div>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => setTab('deck')}>
                덱 보기
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.columns}>
          {picker}
          {panel}
        </div>
      )}

      {exporting && <ExportDialog text={exportDeckList(deck.cards, info)} onClose={() => setExporting(false)} />}
    </main>
  )
}
