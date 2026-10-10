import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AccountApiError, createAuction } from '../api/account'
import { DURATION_LABEL } from '../lib/auctions'
import { newRequestId } from '../lib/packs'
import { won } from '../lib/points'
import Dialog from './deck/Dialog'
import styles from './ListAuctionDialog.module.css'

const DURATIONS = ['1h', '24h', '72h'] as const

/** "경매 등록" from the collection: one free copy of this card, a start price and a length */
export default function ListAuctionDialog({ cardId, name, onClose }: { cardId: string; name: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [price, setPrice] = useState('1,000')
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>('24h')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<{ key: string; price: number; duration: string } | null>(null)
  const value = Number(price.replace(/[^\d]/g, '')) || 0
  const invalid = value < 100 || value > 100_000_000 || value % 100 !== 0

  const submit = async () => {
    if (busy || invalid) return
    setError(null)
    // The same press retried after a lost answer keeps its request id: one auction, not two (K-2)
    if (!request.current || request.current.price !== value || request.current.duration !== duration) {
      request.current = { key: newRequestId(), price: value, duration }
    }
    setBusy(true)
    try {
      const { auctionId } = await createAuction(cardId, value, duration, request.current.key)
      navigate(`/auctions/${auctionId}`)
    } catch (e) {
      if (e instanceof AccountApiError && e.status !== 0 && e.status < 500) request.current = null
      setError(e instanceof AccountApiError ? e.message : '경매를 올리지 못했어요. 다시 눌러 주세요.')
      setBusy(false)
    }
  }

  return (
    <Dialog title={`${name} 경매 등록`} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className={styles.field}>
          <span>시작가 (100P 단위)</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={price}
            aria-invalid={invalid || undefined}
            aria-describedby="list-help"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, '')) || 0
              setPrice(n ? n.toLocaleString('ko-KR') : '')
            }}
          />
        </label>
        <fieldset className={styles.field}>
          <legend>기간</legend>
          <div className={styles.segments}>
            {DURATIONS.map((d) => (
              <label key={d}>
                <input type="radio" name="duration" value={d} checked={duration === d} onChange={() => setDuration(d)} />
                {DURATION_LABEL[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <p id="list-help" className={invalid ? styles.warn : styles.small}>
          {invalid
            ? '시작가는 100P 이상, 100P 단위로 정해 주세요.'
            : `낙찰되면 낙찰가의 5%를 수수료로 빼고 받아요(1P 미만은 버려요, 시작가에 낙찰되면 ${won(Math.floor(value * 0.05))}). 입찰이 없을 때만 취소할 수 있어요.`}
        </p>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            닫기
          </button>
          <button type="submit" className={styles.primary} aria-disabled={busy || invalid || undefined}>
            {busy ? '올리는 중…' : '경매 올리기'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
