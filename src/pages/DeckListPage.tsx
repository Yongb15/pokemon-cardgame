import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import CardImg from '../components/CardImg'
import ImportDialog from '../components/deck/ImportDialog'
import { useDecks } from '../hooks/useDecks'
import { createDeck, DECK_SIZE, deckSize, FORMATS, smallImageUrl, type Deck, type DeckCard } from '../lib/deck'
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

export default function DeckListPage() {
  const decks = useDecks()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [saveError, setSaveError] = useState(false)
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

  function create(init?: { name: string; cards: DeckCard[] }) {
    try {
      const deck = createDeck(init)
      navigate(`/decks/${deck.id}`)
    } catch {
      setSaveError(true)
    }
  }

  const actions = (
    <div className={styles.actions}>
      <button type="button" className={styles.button} onClick={() => setImporting(true)}>
        텍스트로 가져오기
      </button>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => create()}>
        + 새 덱
      </button>
    </div>
  )

  return (
    <main className={styles.main}>
      <div className={styles.pageHead}>
        <div>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            내 덱
          </h1>
          <p className={styles.subtitle}>덱은 이 브라우저에만 저장돼요. 다른 기기에서 보려면 공유 링크를 쓰세요.</p>
        </div>
        {decks.length > 0 && actions}
      </div>

      {saveError && (
        <p className={styles.alert} role="alert">
          브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.
        </p>
      )}

      {decks.length === 0 ? (
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
          onImport={(cards) => create({ name: '가져온 덱', cards })}
        />
      )}
    </main>
  )
}
