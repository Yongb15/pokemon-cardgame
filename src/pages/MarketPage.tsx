import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AccountApiError, getMarket, getMyAuctions, type MarketItem } from '../api/account'
import CardImg from '../components/CardImg'
import { useCardInfo } from '../hooks/useDecks'
import { useSession } from '../hooks/useSession'
import { isEndingSoon, timeLeft } from '../lib/auctions'
import { won } from '../lib/points'
import styles from './MarketPage.module.css'

type Sort = 'ending' | 'new' | 'price'
type Tab = Sort | 'mine'
const TABS: [Tab, string][] = [
  ['ending', '마감 임박'],
  ['new', '새로 등록'],
  ['price', '높은 가격'],
  ['mine', '내 경매'],
]

/** Re-renders every second so the countdowns move */
function useTick() {
  const [, set] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
}

function Lot({ item, info, note }: { item: MarketItem; info: ReturnType<typeof useCardInfo>['info']; note?: string }) {
  const card = info.get(item.cardId)
  const left = item.status === 'open' || item.status === 'ending' ? timeLeft(item.endsAt) : null
  const ended = item.status !== 'open' || !left
  return (
    <li>
      <Link className={styles.lot} to={`/auctions/${item.id}`}>
        <span className={styles.img}>{card && <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} loading="lazy" />}</span>
        <b className={styles.name}>{card ? (card.nameKo ?? card.name) : item.cardId}</b>
        <small className={styles.sub}>
          {card?.set.nameKo ?? ' '} · 입찰 {item.bidCount}건{note ? ` · ${note}` : ''}
        </small>
        <span className={styles.price}>{item.hasBids ? won(item.price) : `시작 ${won(item.price)}`}</span>
        <span className={ended ? styles.ended : isEndingSoon(item.endsAt) ? styles.soon : styles.left}>
          {ended ? (item.status === 'sold' ? '낙찰' : item.status === 'unsold' ? '입찰 없이 끝남' : item.status === 'cancelled' ? '취소됨' : '마감') : `${left} 남음`}
        </span>
      </Link>
    </li>
  )
}

/** /market (docs/design/auction-m7.webp ①): open auctions, and the user's own */
export default function MarketPage() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'new' || raw === 'price' || raw === 'mine' ? raw : 'ending'
  const [data, setData] = useState<{ tab: Tab; items: MarketItem[]; selling?: MarketItem[]; more: boolean; page: number } | null>(null)
  const [error, setError] = useState<{ tab: Tab; message: string } | null>(null)
  const [reload, setReload] = useState(0)
  useTick()

  useEffect(() => {
    document.title = '경매 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  useEffect(() => {
    let stale = false
    const load =
      tab === 'mine'
        ? session.status === 'in'
          ? getMyAuctions().then((r) => ({ tab, items: r.bidding, selling: r.selling, more: false, page: 0 }))
          : null
        : getMarket(tab).then((r) => ({ tab, items: r.items, more: r.more, page: 0 }))
    if (!load) return
    load
      .then((d) => !stale && (setData(d), setError(null)))
      .catch((e: unknown) => !stale && setError({ tab, message: e instanceof AccountApiError ? e.message : '경매를 불러오지 못했어요.' }))
    return () => {
      stale = true
    }
  }, [tab, session.status, reload])

  const current = data?.tab === tab ? data : null
  const ids = [...(current?.items ?? []), ...(current?.selling ?? [])].map((i) => i.cardId)
  const { info } = useCardInfo(ids)

  const more = async () => {
    if (!current || tab === 'mine') return
    const r = await getMarket(tab, current.page + 1)
    setData({ ...current, items: [...current.items, ...r.items], more: r.more, page: current.page + 1 })
  }

  const signedOutMine = tab === 'mine' && session.status === 'out'

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>경매</h1>
          <p className={styles.small}>가상 카드를 포인트로 사고팔아요 · 포인트는 현금 가치가 없고, 사거나 바꿀 수 없어요</p>
        </div>
        <div className={styles.headActions}>
          <Link className={styles.button} to="/collection">
            내 카드 경매 등록
          </Link>
          <Link className={styles.primary} to="/packs">
            카드팩 열기
          </Link>
        </div>
      </div>

      <div className={styles.tabs} role="group" aria-label="보기">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => setParams(value === 'ending' ? {} : { tab: value }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>

      <div className={styles.results}>
        {signedOutMine ? (
          <div className={styles.empty}>
            <h2>로그인하면 내 경매를 볼 수 있어요</h2>
            <Link className={styles.primary} to="/login?next=%2Fmarket%3Ftab%3Dmine">
              로그인
            </Link>
          </div>
        ) : error?.tab === tab ? (
          <p className={styles.alert} role="alert">
            {error.message}{' '}
            <button type="button" className={styles.link} onClick={() => setReload((n) => n + 1)}>
              다시 시도
            </button>
          </p>
        ) : !current ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
        ) : tab === 'mine' ? (
          <>
            <h2 className={styles.section}>내가 올린 경매 {current.selling?.length ?? 0}</h2>
            {current.selling?.length ? (
              <ul className={styles.grid}>{current.selling.map((i) => <Lot key={i.id} item={i} info={info} />)}</ul>
            ) : (
              <p className={styles.small}>아직 올린 경매가 없어요. 내 컬렉션에서 카드를 경매에 올릴 수 있어요.</p>
            )}
            <h2 className={styles.section}>내가 입찰한 경매 {current.items.length}</h2>
            {current.items.length ? (
              <ul className={styles.grid}>{current.items.map((i) => <Lot key={i.id} item={i} info={info} />)}</ul>
            ) : (
              <p className={styles.small}>아직 입찰한 경매가 없어요.</p>
            )}
          </>
        ) : current.items.length === 0 ? (
          <div className={styles.empty}>
            <h2>진행 중인 경매가 없어요</h2>
            <p className={styles.small}>내 컬렉션의 카드를 첫 경매로 올려 보세요.</p>
            <Link className={styles.primary} to="/collection">
              내 카드 경매 등록
            </Link>
          </div>
        ) : (
          <>
            <ul className={styles.grid}>{current.items.map((i) => <Lot key={i.id} item={i} info={info} />)}</ul>
            {current.more && (
              <button type="button" className={styles.button} onClick={() => void more()}>
                더 보기
              </button>
            )}
          </>
        )}
      </div>
    </main>
  )
}
