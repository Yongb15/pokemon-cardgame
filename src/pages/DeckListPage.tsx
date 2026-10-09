import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { ImportResult } from '../api/account'
import CardImg from '../components/CardImg'
import ImportDialog from '../components/deck/ImportDialog'
import { errorMessage, importBrowserDecks, loadAccountDecks, refreshAccountDecks } from '../hooks/useAccountDecks'
import { createInLibrary, useDeckLibrary } from '../hooks/useDeckLibrary'
import { useDecks } from '../hooks/useDecks'
import { DECK_SIZE, deckSize, FORMATS, smallImageUrl, type Deck, type DeckCard } from '../lib/deck'
import styles from './DeckPages.module.css'

function DeckStatus({ deck }: { deck: Deck }) {
  const size = deckSize(deck.cards)
  // `problems` is saved by the editor once it has checked every rule
  const ok = size === DECK_SIZE && deck.problems === 0
  const text = ok
    ? `${size}/${DECK_SIZE} · 규칙 통과`
    : size !== DECK_SIZE
      ? `${size}/${DECK_SIZE}`
      : `${size}/${DECK_SIZE} · 문제 ${deck.problems ?? '?'}개`
  return <span className={ok ? styles.statusOk : styles.statusWarn}>{text}</span>
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
const updatedLabel = (time: number) => (time ? dateFormat.format(time) : '날짜 없음')

// Asking to move this browser's decks into the account: "later" lasts for this tab, "never" for
// this browser (then a quiet link stays instead) (docs/design/deck-sync.webp)
const LATER_KEY = 'card-dex:import-later'
const NEVER_KEY = 'card-dex:import-never'
const readFlag = (storage: () => Storage, key: string) => {
  try {
    return storage().getItem(key) === '1'
  } catch {
    return false
  }
}
const writeFlag = (storage: () => Storage, key: string) => {
  try {
    storage().setItem(key, '1')
  } catch {
    // storage blocked: we just ask again next time
  }
}

function importSummary(r: ImportResult) {
  const parts = [r.imported.length ? `덱 ${r.imported.length}개를 계정에 저장했어요.` : '새로 저장한 덱은 없어요.']
  if (r.duplicates.length) parts.push(`이미 계정에 있던 덱 ${r.duplicates.length}개는 건너뛰었어요.`)
  if (r.overLimit.length) parts.push(`${r.overLimit.length}개는 한도(100) 때문에 이 브라우저에 남겨 뒀어요.`)
  if (r.invalid) parts.push(`읽을 수 없는 덱 ${r.invalid}개는 그대로 뒀어요.`)
  return parts.join(' ')
}

export default function DeckListPage() {
  const library = useDeckLibrary()
  const browserDecks = useDecks()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(() => readFlag(() => sessionStorage, LATER_KEY) || readFlag(() => localStorage, NEVER_KEY))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeading = (useLocation().state as { focusHeading?: boolean } | null)?.focusHeading

  // After deleting a deck the editor is gone: start keyboard focus at the top of the list
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus()
  }, [focusHeading])

  useEffect(() => {
    document.title = '내 덱 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  const mode = library.mode === 'account' ? 'account' : 'local'

  // Coming back to the list: pick up decks changed on another device meanwhile (qa C-2)
  const listReady = library.mode === 'account' && library.status === 'ready'
  const refreshed = useRef(false)
  useEffect(() => {
    if (!listReady || refreshed.current) return
    refreshed.current = true
    void refreshAccountDecks()
  }, [listReady])

  async function create(init?: { name: string; cards: DeckCard[] }) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const deck = await createInLibrary(mode, init ?? {})
      navigate(`/decks/${deck.id}`)
    } catch (e) {
      setError(
        mode === 'account'
          ? errorMessage(e)
          : '브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.',
      )
      setBusy(false)
    }
  }

  async function moveBrowserDecks() {
    setBusy(true)
    setError(null)
    try {
      setNotice(importSummary(await importBrowserDecks()))
      headingRef.current?.focus()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const actions = (
    <div className={styles.actions}>
      <button type="button" className={styles.button} onClick={() => setImporting(true)} disabled={busy}>
        텍스트로 가져오기
      </button>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void create()} disabled={busy}>
        + 새 덱
      </button>
    </div>
  )

  const signedIn = library.mode === 'account'
  const decks = library.mode === 'local' || (library.mode === 'account' && library.status === 'ready') ? library.decks : null
  const showOffer = signedIn && browserDecks.length > 0

  return (
    <main className={styles.main}>
      <div className={styles.pageHead}>
        <div>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            내 덱
          </h1>
          <p className={styles.subtitle}>
            {signedIn
              ? `계정에 저장돼요${decks ? ` · ${decks.length}개 / 100` : ''} · 어느 기기에서나 볼 수 있어요`
              : library.mode === 'local'
                ? '덱은 이 브라우저에만 저장돼요. 로그인하면 계정에 저장해 여러 기기에서 쓸 수 있어요.'
                : ' '}
          </p>
        </div>
        {decks && decks.length > 0 && actions}
      </div>

      {library.mode === 'local' && library.sessionError && (
        <p className={styles.alert} role="alert">
          로그인 상태를 확인하지 못해 이 브라우저의 덱을 보여 드려요.
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.noticeOk} role="status">
          {notice}
        </p>
      )}

      {showOffer &&
        (asked ? (
          <p className={styles.muted}>
            이 브라우저에 덱 {browserDecks.length}개가 남아 있어요.{' '}
            <button type="button" className={styles.linkButton} onClick={() => void moveBrowserDecks()} disabled={busy}>
              계정으로 가져오기
            </button>
          </p>
        ) : (
          <section className={styles.banner} aria-label="브라우저 덱 가져오기">
            <span>
              이 브라우저에 저장된 덱 <b>{browserDecks.length}개</b>가 있어요. 계정에 저장할까요? 저장한 덱은 이 브라우저에서
              지워져요.
            </span>
            <span className={styles.actions}>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void moveBrowserDecks()} disabled={busy}>
                {busy ? '저장하는 중…' : '계정에 저장'}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  writeFlag(() => sessionStorage, LATER_KEY)
                  setAsked(true)
                }}
              >
                나중에
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.danger}`}
                onClick={() => {
                  writeFlag(() => localStorage, NEVER_KEY)
                  setAsked(true)
                }}
              >
                묻지 않기
              </button>
            </span>
          </section>
        ))}

      {library.mode === 'account' && library.status === 'error' ? (
        <p className={styles.alert} role="alert">
          {library.message}{' '}
          <button type="button" className={styles.linkButton} onClick={() => void loadAccountDecks()}>
            다시 시도
          </button>
        </p>
      ) : !decks ? (
        <div className={styles.listSkeleton} aria-busy="true" aria-label="덱을 불러오는 중" />
      ) : decks.length === 0 ? (
        <div className={styles.empty}>
          <h2>아직 만든 덱이 없어요</h2>
          <p>카드를 골라 60장 덱을 만들거나, Pokémon TCG Live 덱 목록을 붙여넣어 시작하세요.</p>
          {actions}
        </div>
      ) : (
        <ul className={styles.deckGrid}>
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link to={`/decks/${deck.id}`} className={styles.deckCard}>
                <div className={styles.cover}>
                  {deck.coverId ? (
                    <CardImg src={smallImageUrl(deck.coverId)} alt="" width={245} height={342} loading="lazy" />
                  ) : (
                    <span className={styles.coverEmpty} aria-hidden="true" />
                  )}
                </div>
                <div className={styles.deckMeta}>
                  <h2 className={styles.deckName}>{deck.name}</h2>
                  <div className={styles.badges}>
                    <span className={styles.formatBadge}>{FORMATS[deck.format]}</span>
                    <DeckStatus deck={deck} />
                  </div>
                  <p className={styles.updated}>{updatedLabel(deck.updatedAt)} 수정</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={(cards) => void create({ name: '가져온 덱', cards })}
        />
      )}
    </main>
  )
}
