import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useCardInfo } from '../hooks/useDecks'
import { removeAlert, usePriceAlerts } from '../hooks/usePriceAlerts'
import { wonKrw } from '../lib/collectionValue'
import { alertState } from '../lib/priceAlerts'
import styles from './PriceAlertList.module.css'

/** Every price alert, under the favorites (docs/design/price-alert.webp ③): set from any card's detail page */
export default function PriceAlertList() {
  const alerts = usePriceAlerts()
  const list = alerts.status === 'ready' ? alerts.alerts : []
  const { info } = useCardInfo(list.map((a) => a.cardId))
  const root = useRef<HTMLElement>(null)
  const remove = async (cardId: string, index: number) => {
    try {
      await removeAlert(cardId)
    } catch {
      return
    }
    // The pressed button is gone: focus the row that took its place, or the heading (qa PA-2)
    requestAnimationFrame(() => {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('li button')
      const next = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)]
      if (next) next.focus()
      else root.current?.querySelector<HTMLElement>('h2')?.focus()
    })
  }
  // Once shown it stays (empty or not), so the heading is there to take focus after the last 지우기
  const [shown, setShown] = useState(false)
  if (list.length && !shown) setShown(true)
  if (!shown) return null
  return (
    <section className={styles.section} aria-labelledby="alerts-title" ref={root}>
      <h2 id="alerts-title" tabIndex={-1}>
        가격 알림 <small>{list.length}/50 · 하루 한 번 모으는 영문판 시세 기준, 한 번 울리면 꺼져요</small>
      </h2>
      {!list.length && <p className={styles.empty}>걸어 둔 가격 알림이 없어요. 카드 상세의 시세에서 걸 수 있어요.</p>}
      <ul>
        {list.map((a, index) => {
          const card = info.get(a.cardId)
          const name = card ? (card.nameKo ?? card.name) : a.cardId
          return (
            <li key={a.cardId}>
              <Link to={`/cards/${encodeURIComponent(a.cardId)}`}>{name}</Link>
              <span className={a.active ? styles.waiting : styles.fired}>
                {wonKrw(a.targetKrw)} 이하 · {alertState(a)}
              </span>
              <button type="button" className={styles.remove} aria-label={`${name} 가격 알림 지우기`} onClick={() => void remove(a.cardId, index)}>
                지우기
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
