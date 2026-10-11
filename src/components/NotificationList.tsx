import { Link } from 'react-router'
import type { NotificationItem } from '../api/account'
import { useCardInfo } from '../hooks/useDecks'
import { ago } from '../lib/notifications'
import { wonKrw } from '../lib/collectionValue'
import { won } from '../lib/points'
import CardImg from './CardImg'
import styles from './NotificationList.module.css'

/** What happened, in words: the card's name and amounts only, never another user (A-3) */
function Text({ item, name }: { item: NotificationItem; name: string }) {
  const amount = item.amount ?? 0
  switch (item.kind) {
    case 'outbid':
      return (
        <>
          <b>{name}</b> 경매에서 더 높은 입찰이 들어왔어요. 현재가 <b>{won(amount)}</b>
        </>
      )
    case 'won':
      return (
        <>
          <b>{name}</b> 낙찰! <b>{won(amount)}</b>를 쓰고 컬렉션에 들어왔어요
        </>
      )
    case 'sold': {
      const cut = Math.floor((amount * 5) / 100)
      return (
        <>
          <b>{name}</b> 판매됐어요. {won(amount)} 중 수수료 {won(cut)}를 빼고 <b>{won(amount - cut)}</b> 받았어요
        </>
      )
    }
    case 'unsold':
      return (
        <>
          <b>{name}</b> 경매가 입찰 없이 끝났어요. 카드는 컬렉션으로 돌아왔어요
        </>
      )
    case 'price':
      return (
        <>
          <b>{name}</b> 시세가 <b>{wonKrw(amount)}</b>이 됐어요 (목표 {wonKrw(item.target ?? 0)} 이하)
        </>
      )
  }
}

/** The list in the bell's popover and on /notifications (docs/design/notify-7d.webp) */
export default function NotificationList({ items, onPick }: { items: NotificationItem[]; onPick?: () => void }) {
  const { info } = useCardInfo(items.map((i) => i.cardId))
  if (!items.length) {
    return (
      <p className={styles.empty}>
        아직 알림이 없어요.
        <br />
        경매에서 밀리거나 낙찰·판매되면 여기에 알려 드려요.
      </p>
    )
  }
  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const card = info.get(item.cardId)
        return (
          <li key={item.id}>
            <Link className={item.read ? styles.item : styles.itemNew} to={item.auctionId ? `/auctions/${item.auctionId}` : `/cards/${encodeURIComponent(item.cardId)}`} onClick={onPick}>
              <span className={styles.thumb}>{card && <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} loading="lazy" />}</span>
              <span className={styles.body}>
                <span className={styles.text}>
                  {!item.read && <span className="visually-hidden">새 알림: </span>}
                  <Text item={item} name={card ? (card.nameKo ?? card.name) : item.cardId} />
                </span>
                <small className={styles.when}>
                  {ago(item.at)}
                  {item.kind === 'outbid' ? ' · 묶여 있던 포인트는 돌려받았어요' : ''}
                </small>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
