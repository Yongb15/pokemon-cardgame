import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { claimToday, usePoints } from '../hooks/usePoints'
import { useSession } from '../hooks/useSession'
import { announcePoints, currentNotice, onNotice, won } from '../lib/points'
import styles from './PointsBar.module.css'

/** "출석 보상 +500P 받았어요" for about 4 s, read out politely (qa 5) */
export function PointsNotice() {
  const [current, setCurrent] = useState(currentNotice)
  useEffect(() => onNotice(setCurrent), [])
  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => setCurrent(null), 4000)
    return () => clearTimeout(timer)
  }, [current])
  return (
    <div className={styles.noticeSlot} role="status">
      {current && (
        <p key={current.id} className={styles.notice}>
          {current.text}
        </p>
      )}
    </div>
  )
}

/**
 * Desktop header (docs/design/points-7a.webp ①): "출석 체크 +500P" until today's is taken, then
 * the balance as a link to the ledger. Phones get both inside the account menu instead.
 */
export default function PointsBar() {
  const session = useSession()
  const points = usePoints()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pill = useRef<HTMLAnchorElement>(null)

  // The first bonus, said once when it lands
  const granted = points.status === 'ready' && points.summary.bonusGranted
  useEffect(() => {
    if (granted) announcePoints('첫 포인트 보너스 10,000P를 받았어요')
  }, [granted])

  if (session.status !== 'in') return null
  if (points.status !== 'ready') return <span className={styles.placeholder} aria-hidden="true" />
  const { summary } = points

  const claim = async () => {
    setBusy(true)
    setError(null)
    const result = await claimToday()
    setBusy(false)
    if (result.kind === 'error') setError(result.message)
    else {
      if (result.kind === 'claimed') announcePoints('출석 보상 +500P 받았어요')
      // The button goes away: focus moves to the balance, not the page (qa 5)
      requestAnimationFrame(() => pill.current?.focus())
    }
  }

  return (
    <div className={styles.bar}>
      {!summary.claimedToday && (
        <button type="button" className={styles.claim} onClick={() => void claim()} disabled={busy}>
          {busy ? '받는 중…' : '출석 체크 +500P'}
        </button>
      )}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
      <Link ref={pill} to="/me#points" className={styles.pill} aria-label={`내 포인트 ${won(summary.available)} · 포인트 내역 보기`}>
        <i className={styles.coin} aria-hidden="true" />
        {won(summary.available)}
      </Link>
    </div>
  )
}
