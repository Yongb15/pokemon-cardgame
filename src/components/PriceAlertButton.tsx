import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AccountApiError } from '../api/account'
import { removeAlert, saveAlert, usePriceAlerts } from '../hooks/usePriceAlerts'
import { useSession } from '../hooks/useSession'
import { wonKrw } from '../lib/collectionValue'
import { alertDefault, alertStep } from '../lib/priceAlerts'
import Dialog from './deck/Dialog'
import styles from './ListAuctionDialog.module.css'
import own from './PriceAlertButton.module.css'

/** The card's English headline in won, as the alert check sees it (the public batch lookup) */
async function currentPrice(cardId: string): Promise<number | null> {
  const res = await fetch(`/api/prices/batch?${new URLSearchParams({ ids: cardId })}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { prices: Record<string, number> }
  return Object.hasOwn(body.prices, cardId) ? body.prices[cardId]! : null
}

/** "가격 알림" beside the price heading (docs/design/price-alert.webp ①): opens the dialog ② */
export default function PriceAlertButton({ cardId, name }: { cardId: string; name: string }) {
  const session = useSession()
  const alerts = usePriceAlerts()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const alert = alerts.status === 'ready' ? alerts.alerts.find((a) => a.cardId === cardId) : undefined

  if (session.status === 'out') {
    return (
      <Link className={own.button} to={`/login?${new URLSearchParams({ next: pathname })}`}>
        🔔 가격 알림
      </Link>
    )
  }
  // A same-size slot while we don't know yet (no shift when it fills in)
  if (session.status !== 'in' || alerts.status !== 'ready') return <span className={own.placeholder} aria-hidden="true" />

  return (
    <>
      <button type="button" className={alert?.active ? `${own.button} ${own.on}` : own.button} onClick={() => setOpen(true)}>
        🔔 {alert ? (alert.active ? `알림 ${wonKrw(alert.targetKrw)} 이하` : '알림 울림 · 다시 켜기') : '가격 알림'}
      </button>
      {open && <AlertDialog cardId={cardId} name={name} target={alert?.targetKrw ?? null} onClose={() => setOpen(false)} />}
    </>
  )
}

function AlertDialog({ cardId, name, target, onClose }: { cardId: string; name: string; target: number | null; onClose: () => void }) {
  const [now, setNow] = useState<number | null | 'loading' | 'error'>('loading')
  const [text, setText] = useState(target ? target.toLocaleString('ko-KR') : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    currentPrice(cardId)
      .then((krw) => {
        if (!live) return
        setNow(krw)
        if (!target && krw) setText(alertDefault(krw).toLocaleString('ko-KR'))
      })
      .catch(() => live && setNow('error'))
    return () => {
      live = false
    }
  }, [cardId, target])

  const value = Number(text.replace(/[^\d]/g, '')) || 0
  const invalid = value < 100 || value > 100_000_000 || value % 100 !== 0
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onClose()
    } catch (e) {
      setError(e instanceof AccountApiError ? e.message : '저장하지 못했어요. 다시 눌러 주세요.')
      setBusy(false)
    }
  }

  return (
    <Dialog title={`${name} 가격 알림`} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          if (!invalid && !busy) void run(() => saveAlert(cardId, value))
        }}
      >
        <p className={styles.small}>
          지금 시세{' '}
          {now === 'loading' ? '…' : now === 'error' ? '확인하지 못했어요' : now === null ? '없음(시세가 생기면 확인해요)' : wonKrw(now)}
        </p>
        <label className={styles.field}>
          <span>이 가격 이하가 되면 (100원 단위)</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={text}
            aria-invalid={invalid || undefined}
            aria-describedby="alert-help"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, '')) || 0
              setText(n ? n.toLocaleString('ko-KR') : '')
            }}
          />
        </label>
        {typeof now === 'number' && (
          <div className={own.chips} role="group" aria-label="빠른 선택">
            {[5, 10, 20].map((pct) => (
              <button key={pct} type="button" onClick={() => setText(alertStep(now, pct).toLocaleString('ko-KR'))}>
                -{pct}%
              </button>
            ))}
          </div>
        )}
        <p id="alert-help" className={invalid && text ? styles.warn : styles.small}>
          {invalid && text
            ? '100원 이상, 100원 단위로 정해 주세요.'
            : '이 가격 이하가 되면 알림 종으로 알려 드려요. 하루 한 번 모으는 영문판 시세 기준이고, 한 번 울리면 꺼져요.'}
        </p>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {target !== null && (
            <button type="button" className={styles.button} disabled={busy} onClick={() => void run(() => removeAlert(cardId))}>
              알림 끄기
            </button>
          )}
          <button type="button" className={styles.button} onClick={onClose}>
            닫기
          </button>
          <button type="submit" className={styles.primary} aria-disabled={busy || invalid || undefined}>
            {busy ? '저장하는 중…' : '저장'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
