import { useEffect, useRef, useState } from 'react'
import { AccountApiError, reportAuction, type ReportReason } from '../api/account'
import Dialog from './deck/Dialog'
import styles from './ListAuctionDialog.module.css'
import own from './ReportDialog.module.css'

const REASONS: [ReportReason, string][] = [
  ['price_manipulation', '가격 조작 의심 (여러 계정으로 입찰 등)'],
  ['rmt', '현금 거래 유도'],
  ['wrong_item', '카드·설명이 이상해요'],
  ['other', '기타'],
]

/** "이 경매 신고" (docs/design/moderation.webp ①): a reason, an optional note, nothing told to the seller or bidders */
export default function ReportDialog({ auctionId, onClose }: { auctionId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('price_manipulation')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeAfter = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (done) closeAfter.current?.focus()
  }, [done])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await reportAuction(auctionId, reason, note.trim() || undefined)
      setDone(true)
    } catch (e) {
      setError(e instanceof AccountApiError ? e.message : '신고하지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="이 경매 신고" onClose={onClose}>
      {done ? (
        <div className={styles.form}>
          <p role="status">신고했어요. 운영자가 확인할게요.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} ref={closeAfter} onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className={styles.field}>
            <legend>사유</legend>
            <div className={own.reasons}>
              {REASONS.map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={styles.field}>
            <span>자세히 (선택, 200자)</span>
            <textarea className={own.note} maxLength={200} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className={styles.small}>신고한 사실은 판매자·입찰자에게 알리지 않아요. 운영자가 확인해요. 연락처 같은 개인정보는 적지 말아 주세요.</p>
          {error && (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={onClose}>
              닫기
            </button>
            <button type="submit" className={styles.primary} aria-disabled={busy || undefined}>
              {busy ? '보내는 중…' : '신고'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
