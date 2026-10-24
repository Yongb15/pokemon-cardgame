import { useRef, useState } from 'react'
import { AccountApiError, craftCard, exchangeCards } from '../api/account'
import { setPointsSummary } from '../hooks/usePoints'
import { newRequestId } from '../lib/packs'
import { won } from '../lib/points'
import Dialog from './deck/Dialog'
import styles from './ListAuctionDialog.module.css'

type Props =
  /** Duplicates to points: up to `max` copies (one always stays), `value` points each (exchange.md §2) */
  | { mode: 'exchange'; cardId: string; name: string; max: number; value: number; onClose: () => void; onDone: () => void }
  /** Points to one copy (exchange.md §3) */
  | { mode: 'craft'; cardId: string; name: string; cost: number; onClose: () => void; onDone: () => void }

/** Confirm, with the count and the points shown before anything happens; neither can be undone (Security X-9) */
export default function CardTradeDialog(props: Props) {
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One request id per confirmation: a retry after a lost answer sends the same one
  const key = useRef(newRequestId())
  const exchange = props.mode === 'exchange'
  const points = exchange ? props.value * count : props.cost

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = exchange ? await exchangeCards(props.cardId, count, key.current) : await craftCard(props.cardId, key.current)
      setPointsSummary(res.summary)
      props.onDone()
      props.onClose()
    } catch (e) {
      // Answered (4xx): a new press is a new request
      if (e instanceof AccountApiError && e.status !== 0 && e.status < 500) key.current = newRequestId()
      setError(e instanceof AccountApiError ? e.message : '처리하지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={exchange ? `${props.name} 교환` : `${props.name} 만들기`} onClose={props.onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {exchange && (
          <label className={styles.field}>
            <span>교환할 장수 (최대 {props.max}장, 1장은 남겨요)</span>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={props.max}
              value={count}
              onChange={(e) => setCount(Math.min(props.max, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
            />
          </label>
        )}
        <p className={styles.small}>
          {exchange ? `${won(props.value)} × ${count}장 = ` : '필요한 포인트 '}
          <b>{won(points)}</b>
          {exchange ? ' 받아요.' : '를 써요.'} 되돌릴 수 없어요.
        </p>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={props.onClose}>
            닫기
          </button>
          <button type="submit" className={styles.primary} aria-disabled={busy || undefined}>
            {busy ? '처리 중…' : exchange ? `${count}장 교환하기` : `${won(points)}로 만들기`}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
