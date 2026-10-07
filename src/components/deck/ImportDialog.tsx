import { useEffect, useState } from 'react'
import { getCardsBatch } from '../../api/cards'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { rememberCards } from '../../hooks/useDecks'
import { deckSize, MAX_IMPORT_LENGTH, parseDeckList, sanitizeCards, type DeckCard, type ImportProblem } from '../../lib/deck'
import Dialog from './Dialog'
import styles from './deck.module.css'

const EXAMPLE = `Pokémon: 3
3 Charizard ex PAF 54
4 Charmander PAF 7

Trainer: 4
4 Rare Candy PAF 89`

interface Checked {
  text: string
  cards: DeckCard[]
  problems: ImportProblem[]
  error: Error | null
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Paste a Pokémon TCG Live deck list; lines we can't match are listed and left out */
export default function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (cards: DeckCard[]) => void }) {
  const [text, setText] = useState('')
  const debounced = useDebouncedValue(text, 400)
  const [checked, setChecked] = useState<Checked | null>(null)

  useEffect(() => {
    if (!debounced.trim()) return
    const controller = new AbortController()
    const { lines, problems } = parseDeckList(debounced)
    const ids = lines.flatMap((l) => l.candidates)
    const lookup = ids.length ? getCardsBatch(ids, controller.signal) : Promise.resolve([])
    lookup
      .then((found) => {
        rememberCards(found)
        const known = new Set(found.map((c) => c.id))
        const cards: DeckCard[] = []
        const unmatched: ImportProblem[] = []
        for (const line of lines) {
          const id = line.candidates.find((c) => known.has(c))
          if (id) cards.push({ id, count: line.count })
          else unmatched.push({ line: line.line, text: line.text, reason: '카드를 찾을 수 없어요 (세트 코드와 번호 확인)' })
        }
        const all = [...problems, ...unmatched].sort((a, b) => a.line - b.line)
        setChecked({ text: debounced, cards: sanitizeCards(cards), problems: all, error: null })
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) setChecked({ text: debounced, cards: [], problems, error: error as Error })
      })
    return () => controller.abort()
  }, [debounced])

  const current = text.trim() && checked?.text === text ? checked : null
  const checking = !!text.trim() && !current
  const count = current ? deckSize(current.cards) : 0

  return (
    <Dialog title="텍스트로 가져오기" description="Pokémon TCG Live에서 내보낸 덱 목록을 붙여넣으세요." onClose={onClose}>
      <label htmlFor="deck-import" className="visually-hidden">
        덱 목록
      </label>
      <textarea
        id="deck-import"
        className={styles.textarea}
        value={text}
        maxLength={MAX_IMPORT_LENGTH}
        placeholder={EXAMPLE}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.importResult} role="status" aria-live="polite">
        {!text.trim() && <p>한 줄에 한 카드씩, “수량 이름 세트코드 번호” 형식이에요.</p>}
        {checking && <p>확인하는 중…</p>}
        {current?.error && <p className={styles.problemText}>카드 정보를 불러오지 못했어요. {current.error.message}</p>}
        {current && !current.error && (
          <>
            <p>
              <b className={styles.okText}>{count}장 인식</b>
              {current.problems.length > 0 && (
                <>
                  {' · '}
                  <b className={styles.problemText}>{current.problems.length}줄 확인 필요</b>
                </>
              )}
            </p>
            {current.problems.length > 0 && (
              <>
                <ul className={styles.problems}>
                  {current.problems.slice(0, 20).map((p) => (
                    <li key={`${p.line}-${p.reason}`}>
                      {p.line > 0 && <span>{p.line}줄</span>} {p.text && <code>{p.text}</code>} — {p.reason}
                    </li>
                  ))}
                </ul>
                <p className={styles.hint}>확인이 필요한 줄은 빼고 가져와요. 나중에 직접 추가할 수 있어요.</p>
              </>
            )}
          </>
        )}
      </div>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!current || !current.cards.length}
          onClick={() => current && onImport(current.cards)}
        >
          새 덱으로 가져오기
        </button>
      </div>
    </Dialog>
  )
}
