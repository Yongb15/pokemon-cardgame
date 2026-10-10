import { useEffect, useRef, useState } from 'react'
import { AccountApiError, getPointEntries, type PointEntry, type PointKind } from '../api/account'
import { loadPoints, usePoints } from '../hooks/usePoints'
import { won } from '../lib/points'
import styles from './PointsLedger.module.css'

const KIND_LABEL: Record<PointKind, string> = {
  // Existing accounts get it at the 7a release too, so not "가입" (qa 7)
  signup_bonus: '첫 포인트 보너스',
  daily_bonus: '출석 보상',
  pack_purchase: '카드팩',
  sale_income: '판매 수입',
  sale_fee: '판매 수수료',
  purchase: '낙찰',
  admin_adjust: '포인트 조정',
}

/** "10.11" in Korea time */
const kstDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`
}
/** A real minus sign, and a plus for income */
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ko-KR')}`

/** "포인트" on the my page (docs/design/points-7a.webp ④): balance, held, the ledger with paging */
export default function PointsLedger() {
  const points = usePoints()
  const [entries, setEntries] = useState<PointEntry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const balance = points.status === 'ready' ? points.summary.balance : null
  const root = useRef<HTMLElement>(null)

  // From the header's balance link (/me#points): bring this section into view once
  useEffect(() => {
    if (window.location.hash === '#points') root.current?.scrollIntoView({ block: 'start' })
  }, [])

  // The first page, again whenever the balance changes (a check-in elsewhere on the page)
  useEffect(() => {
    if (balance === null) return
    let stale = false
    getPointEntries(null)
      .then((page) => {
        if (stale) return
        setEntries(page.entries)
        setNext(page.next)
        setError(null)
      })
      .catch((e: unknown) => !stale && setError(e instanceof AccountApiError ? e.message : '내역을 불러오지 못했어요.'))
    return () => {
      stale = true
    }
  }, [balance])

  const more = async () => {
    if (!next) return
    setLoadingMore(true)
    try {
      const page = await getPointEntries(next)
      setEntries((list) => [...(list ?? []), ...page.entries])
      setNext(page.next)
    } catch (e) {
      setError(e instanceof AccountApiError ? e.message : '내역을 불러오지 못했어요.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section ref={root} className={styles.section} aria-labelledby="points-title" id="points">
      <h2 id="points-title">포인트</h2>
      {points.status === 'error' ? (
        <p className={styles.alert} role="alert">
          {points.message}{' '}
          <button type="button" className={styles.link} onClick={() => void loadPoints()}>
            다시 시도
          </button>
        </p>
      ) : (
        <dl className={styles.sum}>
          <div>
            <dt>잔액</dt>
            <dd>{points.status === 'ready' ? won(points.summary.balance) : '…'}</dd>
          </div>
          <div>
            <dt>입찰 보류 (묶인 포인트)</dt>
            <dd>{points.status === 'ready' ? won(points.summary.held) : '…'}</dd>
          </div>
          <div>
            <dt>쓸 수 있음</dt>
            <dd className={styles.available}>{points.status === 'ready' ? won(points.summary.available) : '…'}</dd>
          </div>
        </dl>
      )}

      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : entries === null ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="내역을 불러오는 중" />
      ) : entries.length === 0 ? (
        <p className={styles.empty}>아직 내역이 없어요.</p>
      ) : (
        <ol className={styles.ledger} aria-label="포인트 내역 (최근 순)">
          {entries.map((e) => (
            <li key={e.id}>
              <span className={styles.day}>{kstDay(e.createdAt)}</span>
              <span>{KIND_LABEL[e.kind] ?? e.kind}</span>
              <span className={e.amount > 0 ? styles.plus : styles.minus}>{signed(e.amount)}</span>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <button type="button" className={styles.more} onClick={() => void more()} disabled={loadingMore}>
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}
      <p className={styles.note}>
        포인트는 현금 가치가 없고, 사거나 바꿀 수 없어요. 내역은 지워지지 않는 기록이고, 잔액은 이 기록의 합과 항상 같아요. 날짜는 한국 시간이에요.
      </p>
    </section>
  )
}
