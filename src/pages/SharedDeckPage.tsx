import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import DeckCardList from '../components/deck/DeckCardList'
import DeckChecks from '../components/deck/DeckChecks'
import ExportDialog from '../components/deck/ExportDialog'
import { NotFoundState } from '../components/ListStates'
import { useCardInfo } from '../hooks/useDecks'
import { checkDeck, createDeck, DECK_SIZE, deckFromShareParams, deckSize, exportDeckList, FORMATS, problemCount } from '../lib/deck'
import styles from './DeckPages.module.css'

/** A deck opened from a share link: read-only until the viewer saves a copy of their own */
export default function SharedDeckPage() {
  const [params] = useSearchParams()
  const shared = useMemo(() => deckFromShareParams(params), [params])
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const ids = useMemo(() => shared?.cards.map((c) => c.id) ?? [], [shared])
  const { info, loading, error, unknownIds } = useCardInfo(ids)

  useEffect(() => {
    document.title = `${shared?.name ?? '공유 링크를 읽을 수 없어요'} · Pokémon Card Dex`
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [shared?.name])

  if (!shared) {
    return (
      <main className={styles.main}>
        <meta name="robots" content="noindex" />
        <NotFoundState
          title="공유 링크를 읽을 수 없어요"
          description={
            <>
              링크가 잘렸거나 손상됐어요. 보낸 사람에게 다시 요청해 주세요.
              <br />
              <Link to="/decks">내 덱 목록으로</Link>
            </>
          }
        />
      </main>
    )
  }

  const total = deckSize(shared.cards)
  const checks = checkDeck(shared.cards, shared.format, info)
  const problems = problemCount(checks)

  function saveCopy() {
    try {
      // Always a new deck: a link never overwrites one the viewer already has
      const deck = createDeck(shared!)
      navigate(`/decks/${deck.id}`)
    } catch {
      setSaveError(true)
    }
  }

  return (
    <main className={styles.main}>
      {/* Every link is a different deck; keep them out of search results */}
      <meta name="robots" content="noindex" />
      <div className={styles.banner}>
        <p>
          <b>공유받은 덱이에요</b> 저장하면 내 덱 목록에 새 덱으로 추가돼요. 기존 덱은 바뀌지 않아요.
        </p>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={saveCopy}>
          내 덱으로 저장
        </button>
      </div>
      {saveError && (
        <p className={styles.alert} role="alert">
          브라우저에 저장하지 못했어요. 시크릿 모드이거나 저장 공간이 부족할 수 있어요.
        </p>
      )}

      <div className={styles.sharedHead}>
        <div>
          <h1 className={styles.title}>{shared.name}</h1>
          <div className={styles.badges}>
            <span className={styles.formatBadge}>{FORMATS[shared.format]}</span>
            {!loading && !error && (
              <span className={total === DECK_SIZE && !problems ? styles.statusOk : styles.statusWarn}>
                {total}/{DECK_SIZE}
                {total === DECK_SIZE && (problems ? ` · 문제 ${problems}개` : ' · 규칙 통과')}
              </span>
            )}
          </div>
        </div>
        <button type="button" className={styles.button} onClick={() => setExporting(true)} disabled={loading || !!error}>
          PTCG Live로 내보내기
        </button>
      </div>

      {unknownIds.length > 0 && (
        <p className={styles.alert}>
          지금 카드 데이터에 없는 카드 {unknownIds.length}종은 보여 줄 수 없어요. 저장하면 덱 편집 화면에서 뺄 수 있어요.
        </p>
      )}
      {error ? (
        <p className={styles.alert} role="alert">
          카드 정보를 불러오지 못했어요. {error.message}
        </p>
      ) : loading ? (
        <p className={styles.muted}>카드 정보를 불러오는 중…</p>
      ) : (
        <div className={styles.sharedBody}>
          <DeckCardList cards={shared.cards} info={info} columns />
          {problems > 0 && <DeckChecks checks={checks} />}
        </div>
      )}

      {exporting && <ExportDialog text={exportDeckList(shared.cards, info)} onClose={() => setExporting(false)} />}
    </main>
  )
}
