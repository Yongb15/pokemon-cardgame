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
  if (!list.length) return null
  return (
    <section className={styles.section} aria-labelledby="alerts-title">
      <h2 id="alerts-title">
        가격 알림 <small>{list.length}/50 · 하루 한 번 모으는 영문판 시세 기준, 한 번 울리면 꺼져요</small>
      </h2>
      <ul>
        {list.map((a) => {
          const card = info.get(a.cardId)
          const name = card ? (card.nameKo ?? card.name) : a.cardId
          return (
            <li key={a.cardId}>
              <Link to={`/cards/${encodeURIComponent(a.cardId)}`}>{name}</Link>
              <span className={a.active ? styles.waiting : styles.fired}>
                {wonKrw(a.targetKrw)} 이하 · {alertState(a)}
              </span>
              <button type="button" className={styles.remove} aria-label={`${name} 가격 알림 지우기`} onClick={() => void removeAlert(a.cardId).catch(() => undefined)}>
                지우기
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
