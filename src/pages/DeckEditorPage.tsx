import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import CardPicker from '../components/deck/CardPicker'
import DeckCardList from '../components/deck/DeckCardList'
import DeckChecks from '../components/deck/DeckChecks'
import DeckStats from '../components/deck/DeckStats'
import ExportDialog from '../components/deck/ExportDialog'
import { NotFoundState } from '../components/ListStates'
import {
  copyName,
  createInAccount,
  errorMessage,
  loadAccountDecks,
  reloadFromAccount,
  saveInAccount,
} from '../hooks/useAccountDecks'
import { removeFromLibrary, useDeckLibrary } from '../hooks/useDeckLibrary'
import { useCardInfo } from '../hooks/useDecks'
import { useMediaQuery } from '../hooks/useMediaQuery'
import {
  checkDeck,
  cleanDeckName,
  copiesByName,
  DECK_SIZE,
  deckSize,
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
  const library = useDeckLibrary()
  const decks = library.mode === 'local' || (library.mode === 'account' && library.status === 'ready') ? library.decks : null
  const deck = decks?.find((d) => d.id === deckId)
  const [lookup, setLookup] = useState<{ id: string; state: 'loading' | 'missing' } | null>(null)
  const lookupState = lookup && lookup.id === deckId ? lookup.state : null
  if (library.mode === 'account' && library.status === 'ready' && !deck && deckId && lookupState === null) {
    setLookup({ id: deckId, state: 'loading' })
  }
  useEffect(() => {
    if (lookupState !== 'loading' || !deckId) return
    // Found: it lands in the list (and this page shows it); not found or not ours: 404
    reloadFromAccount(deckId).catch(() => setLookup({ id: deckId, state: 'missing' }))
  }, [lookupState, deckId])

  useEffect(() => {
    document.title = `${deck?.name ?? '덱을 찾을 수 없어요'} · Pokémon Card Dex`
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [deck?.name])

  if (library.mode === 'account' && library.status === 'error') {
    return (
      <main className={styles.main}>
        <p className={styles.alert} role="alert">
          {library.message}{' '}
          <button type="button" className={styles.linkButton} onClick={() => void loadAccountDecks()}>
            다시 시도
          </button>
        </p>
      </main>
    )
  }
  // Signed in or not isn't known yet, or the account's decks are on their way; or the account has
  // a deck this tab's list doesn't (made on another device): ask for it by id (qa C-2)
  if (!decks || (library.mode === 'account' && !deck && lookupState !== 'missing')) {
    return (
      <main className={styles.main}>
        <div className={styles.listSkeleton} aria-busy="true" aria-label="덱을 불러오는 중" />
      </main>
    )
  }

  if (!deck) {
    return (
      <main className={styles.main}>
        <meta name="robots" content="noindex" />
        <NotFoundState
          title="덱을 찾을 수 없어요"
          description={
            <>
              {library.mode === 'account' ? '계정에 없는 덱이거나 삭제됐어요.' : '이 브라우저에 저장된 덱이 아니거나 삭제됐어요.'}
              <br />
              <Link to="/decks">내 덱 목록으로</Link>
            </>
          }
        />
      </main>
    )
  }
  return <Editor key={deck.id} deck={deck} mode={library.mode === 'account' ? 'account' : 'local'} />
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'
const SAVE_TEXT: Record<SaveState, string> = {
  saved: '저장됨',
  pending: '저장 대기 중…',
  saving: '저장 중…',
  error: '저장하지 못했어요',
  conflict: '저장 멈춤',
}
const AUTOSAVE_MS = 800

function Editor({ deck: stored, mode }: { deck: Deck; mode: 'local' | 'account' }) {
  const navigate = useNavigate()
  // Account decks are edited in memory and saved a moment later (docs/design/deck-sync.webp);
  // browser decks save on every change, as before
  const [draft, setDraft] = useState(stored)
  const deck = mode === 'account' ? draft : stored
  const [saveState, setSaveStateOnly] = useState<SaveState>('saved')
  const saveStateRef = useRef<SaveState>('saved')
  const setSaveState = (next: SaveState) => {
    saveStateRef.current = next
    setSaveStateOnly(next)
  }
  const conflictBox = useRef<HTMLDivElement>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = useRef(stored)
  const edits = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef(false)
  const conflicted = useRef(false)

  async function flush() {
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (inflight.current || conflicted.current) return
    inflight.current = true
    const sent = edits.current
    setSaveState('saving')
    try {
      const result = await saveInAccount(latest.current)
      if (result === 'conflict') {
        // Another device saved first: keep this screen's changes, stop saving, let the user choose
        conflicted.current = true
        setSaveState('conflict')
        return
      }
      latest.current = { ...latest.current, version: result.version, updatedAt: result.updatedAt }
      setDraft((d) => ({ ...d, version: result.version }))
      setSaveError(null)
      setSaveState(edits.current === sent ? 'saved' : 'pending')
    } catch (error) {
      setSaveState('error')
      setSaveError(errorMessage(error, '저장하지 못했어요. 인터넷 연결을 확인해 주세요.'))
    } finally {
      inflight.current = false
      // Changes made while this save was on its way go next
      if (edits.current !== sent && !conflicted.current && timer.current === undefined) schedule()
    }
  }

  function schedule() {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      void flush()
    }, AUTOSAVE_MS)
  }

  // Leaving with a change not yet saved: send it now; closing the tab first asks
  useEffect(() => {
    if (mode !== 'account') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Also when saving stopped (conflict) or failed: the screen holds changes the account doesn't (qa C-4)
      const unsaved = saveStateRef.current === 'error' || saveStateRef.current === 'conflict'
      if (timer.current !== undefined || inflight.current || unsaved) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (timer.current !== undefined) void flush()
    }
    // Once per editor: flush reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Open on the account's latest copy: the list this tab loaded may be older (qa C-1)
  useEffect(() => {
    if (mode !== 'account') return
    reloadFromAccount(stored.id)
      .then((fresh) => {
        if (edits.current > 0) return // already editing: the next save settles it (or reports a conflict)
        latest.current = fresh
        setDraft(fresh)
        setName(fresh.name)
      })
      .catch(() => {
        // keep the list's copy; a save will say if something is wrong
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, stored.id])

  // A conflict moves focus to its choices (qa C-7)
  useEffect(() => {
    if (saveState === 'conflict') conflictBox.current?.focus()
  }, [saveState])
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
    if (mode === 'account') {
      latest.current = { ...latest.current, ...next }
      setDraft(latest.current)
      edits.current += 1
      if (conflicted.current) return // kept on screen; the user chooses what to do with it
      setSaveState('pending')
      schedule()
      return
    }
    try {
      putDeck({ ...deck, ...next })
    } catch {
      setNotice({ kind: 'error', text: '브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.' })
    }
  }

  async function loadLatest() {
    try {
      const fresh = await reloadFromAccount(deck.id)
      latest.current = fresh
      conflicted.current = false
      setDraft(fresh)
      setName(fresh.name)
      setSaveState('saved')
      setSaveError(null)
    } catch (error) {
      setSaveError(errorMessage(error))
    }
  }

  async function saveAsCopy() {
    try {
      const copy = await createInAccount({ name: copyName(deck.name), format: deck.format, cards: deck.cards })
      navigate(`/decks/${copy.id}`, { replace: true, state: { notice: '내 변경을 사본으로 저장했어요.' } })
    } catch (error) {
      setSaveError(errorMessage(error))
    }
  }

  // Remember the cover and rule status for the deck list, once every card's details are in
  const coverId = deck.cards.find((c) => info.get(c.id)?.supertype === 'Pokémon')?.id ?? deck.cards[0]?.id
  useEffect(() => {
    if (loading || error) return
    if (deck.coverId === coverId && deck.problems === problems) return
    if (mode === 'account') {
      // Kept for the next real save: opening a deck mustn't save (bumps the version: qa C-1, C-5)
      latest.current = { ...latest.current, coverId, problems }
      setDraft(latest.current)
      return
    }
    try {
      putDeck({ ...deck, coverId, problems })
    } catch {
      // only list-page extras; an edit that can't be saved already shows the storage error
    }
  }, [loading, error, deck, coverId, problems, mode])

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

  async function remove() {
    if (!window.confirm(`“${deck.name}” 덱을 삭제할까요? 되돌릴 수 없어요.`)) return
    try {
      window.clearTimeout(timer.current)
      timer.current = undefined
      await removeFromLibrary(mode, deck.id)
      // The list page moves focus to its heading, so keyboard users don't land on <body>
      navigate('/decks', { replace: true, state: { focusHeading: true } })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: mode === 'account' ? errorMessage(error, '삭제하지 못했어요.') : '삭제하지 못했어요. 브라우저 저장소를 사용할 수 없어요.',
      })
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

      {mode === 'account' && (
        <>
          <span className={styles.saveState} data-state={saveState} role="status">
            {SAVE_TEXT[saveState]}
          </span>
          {saveState === 'error' && (
            <p className={styles.alert} role="alert">
              {saveError}{' '}
              <button type="button" className={styles.linkButton} onClick={() => void flush()}>
                다시 시도
              </button>
            </p>
          )}
          {saveState === 'conflict' && (
            <div className={styles.conflict} role="alert" ref={conflictBox} tabIndex={-1}>
              <b>다른 기기에서 이 덱이 바뀌었어요.</b>
              <span>지금 화면의 변경은 저장되지 않았고, 그대로 남아 있어요. 자동 저장은 멈췄어요.</span>
              {saveError && <span>{saveError}</span>}
              <span className={styles.actions}>
                <button type="button" className={styles.button} onClick={() => void loadLatest()}>
                  최신 버전 불러오기
                </button>
                <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void saveAsCopy()}>
                  내 변경을 사본으로 저장
                </button>
              </span>
            </div>
          )}
        </>
      )}

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
        <>
          <DeckChecks checks={checks} />
          <DeckStats cards={deck.cards} info={info} defaultOpen={!isNarrow} />
        </>
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
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => void remove()}>
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
                {mode === 'account' &&
                  (saveState === 'conflict' || saveState === 'error' ? (
                    <p className={styles.bottomProblems} role="alert">
                      {saveState === 'conflict' ? '저장 멈춤: 다른 기기에서 바뀌었어요' : '저장하지 못했어요'} · 덱 탭에서 확인
                    </p>
                  ) : (
                    <span className={styles.saveState} data-state={saveState}>
                      {SAVE_TEXT[saveState]}
                    </span>
                  ))}
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
