import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AccountApiError, cancelAuction, getAuction, getMyAuction, placeBid, type AuctionMine, type AuctionState } from '../api/account'
import CardImg from '../components/CardImg'
import { useCardInfo } from '../hooks/useDecks'
import { loadPoints, usePoints } from '../hooks/usePoints'
import { useSession } from '../hooks/useSession'
import { learnServerTime, serverNow, timeLeft } from '../lib/auctions'
import { newRequestId } from '../lib/packs'
import { won } from '../lib/points'
import styles from './AuctionPage.module.css'

const FEE_PERCENT = 5
const fee = (n: number) => Math.floor((n * FEE_PERCENT) / 100)
const digits = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0
const grouped = (n: number) => (n ? n.toLocaleString('ko-KR') : '')

/** /auctions/:id (docs/design/auction-m7.webp ②, design §9): the state, the bid box, the result */
export default function AuctionPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const points = usePoints()
  const [state, setState] = useState<AuctionState | null>(null)
  const [missing, setMissing] = useState(false)
  const [mine, setMine] = useState<AuctionMine | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [live, setLive] = useState<string>('')
  const [, tick] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef<{ amount: number; key: string } | null>(null)
  const signedIn = session.status === 'in'
  const { info } = useCardInfo(state ? [state.cardId] : [])
  const card = state ? info.get(state.cardId) : undefined

  // Never go back in version: a cached poll older than our own bid is ignored (qa §10)
  const accept = useCallback((next: AuctionState) => {
    setState((prev) => {
      if (prev && next.version < prev.version && prev.status === next.status) return prev
      if (prev && next.extensions > prev.extensions) {
        setLive(next.extensions >= next.maxExtensions ? '마감이 늘었어요. 이제 더 이상 연장되지 않아요.' : `마감이 2분 늘었어요 (${next.extensions}/${next.maxExtensions})`)
      }
      return next
    })
  }, [])

  const loadMine = useCallback(async () => {
    if (!signedIn) return
    try {
      const r = await getMyAuction(id)
      learnServerTime(r.serverNow)
      setMine((prev) => {
        if (prev?.isTop && !r.mine.isTop && prev.held) setLive(`더 높은 입찰이 들어와 보류한 ${won(prev.held)}를 돌려받았어요.`)
        return r.mine
      })
    } catch {
      // the public view still works
    }
  }, [id, signedIn])

  useEffect(() => {
    document.title = '경매 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // Polling: every 2.5 s, every second in the last minute, paused while the tab is hidden (A-4)
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const run = async () => {
      if (stop) return
      if (document.visibilityState === 'visible') {
        try {
          accept(await getAuction(id))
        } catch (e) {
          if (e instanceof AccountApiError && e.status === 404) {
            setMissing(true)
            return
          }
        }
      }
      const ends = stateRef.current ? Date.parse(stateRef.current.endsAt) - serverNow() : Infinity
      const done = stateRef.current && ['sold', 'unsold', 'cancelled'].includes(stateRef.current.status)
      if (!done) timer = setTimeout(() => void run(), ends < 60_000 ? 1000 : 2500)
    }
    void run()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [id, accept])
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  // The countdown moves every second
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // The version changed: someone else may have outbid us, so refresh our side
  const version = state?.version
  useEffect(() => {
    if (version !== undefined && mine?.isTop) void loadMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  // Ended (sold/unsold/cancelled): our side and our points, once
  const finished = state ? ['sold', 'unsold', 'cancelled'].includes(state.status) : false
  useEffect(() => {
    if (!finished) return
    void loadMine()
    if (signedIn) void loadPoints()
  }, [finished, loadMine, signedIn])

  if (missing) {
    return (
      <main className={styles.main}>
        <h1 className={styles.title}>경매를 찾을 수 없어요</h1>
        <Link className={styles.button} to="/market">
          경매 목록으로
        </Link>
      </main>
    )
  }

  const left = state ? timeLeft(state.endsAt) : null
  const timeUp = !!state && !finished && !left
  const available = points.status === 'ready' ? points.summary.available : null
  const value = digits(amount)
  // Raising your own top bid only needs the difference (design §9)
  const need = mine?.isTop && state?.topAmount ? value - state.topAmount : value
  const short = available !== null && value > 0 && need > available ? need - available : 0
  const tooLow = !!state && value > 0 && value < state.minBid

  const submit = async () => {
    if (!state || busy || !value) return
    setMessage(null)
    if (!pending.current || pending.current.amount !== value) pending.current = { amount: value, key: newRequestId() }
    setBusy(true)
    try {
      const r = await placeBid(id, value, pending.current.key)
      pending.current = null
      learnServerTime(r.serverNow)
      accept(r.state)
      setMine(r.mine)
      void loadPoints()
      const k = r.result.kind
      if (k === 'ok' || k === 'repeat') {
        setMessage({ ok: true, text: `${won(value)}에 입찰했어요. 현재 최고 입찰자예요.` })
        setAmount('')
      } else if (k === 'too_low') {
        setMessage({ ok: false, text: `방금 ${won(r.state.topAmount ?? 0)} 입찰이 들어왔어요. 최소 ${won(r.result.minBid)}부터 가능해요.` })
        setAmount(grouped(r.result.minBid))
        input.current?.focus()
      } else if (k === 'insufficient') {
        setMessage({ ok: false, text: `포인트가 ${won(r.result.need - r.result.available)} 부족해요.` })
      } else if (k === 'own') setMessage({ ok: false, text: '내 경매에는 입찰할 수 없어요.' })
      else setMessage({ ok: false, text: '경매가 끝났어요.' })
    } catch (e) {
      if (e instanceof AccountApiError && e.status !== 0 && e.status < 500) pending.current = null
      setMessage({
        ok: false,
        text: e instanceof AccountApiError && e.status === 429 ? `잠시 후 다시 입찰해 주세요 (${e.retryAfter ?? 60}초).` : e instanceof AccountApiError ? e.message : '입찰하지 못했어요. 다시 눌러 주세요.',
      })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setMessage(null)
    try {
      await cancelAuction(id)
      accept(await getAuction(id))
      setMessage({ ok: true, text: '경매를 취소했어요. 카드는 내 컬렉션에 그대로 있어요.' })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof AccountApiError ? e.message : '취소하지 못했어요.' })
    }
  }

  const result = () => {
    if (!state) return null
    if (state.status === 'cancelled') return '판매자가 취소한 경매예요.'
    if (state.status === 'unsold') return mine?.isSeller ? '입찰 없이 끝났어요. 카드는 내 컬렉션에 그대로 있어요.' : '입찰 없이 끝났어요.'
    if (state.status !== 'sold' || state.topAmount === null) return null
    if (mine?.isSeller) return `판매됐어요 · +${won(state.topAmount - fee(state.topAmount))} (수수료 ${won(fee(state.topAmount))})`
    if (mine?.isTop) return '낙찰! 내 컬렉션에 추가됐어요.'
    if (mine?.myAlias) return `${state.topAlias}님이 ${won(state.topAmount)}에 낙찰받았어요. 보류한 포인트는 돌려받았어요.`
    return `${state.topAlias}님이 ${won(state.topAmount)}에 낙찰받았어요.`
  }

  const you = (alias: string) => (mine?.myAlias === alias ? `${alias} (나)` : alias)

  return (
    <main className={styles.main}>
      <Link className={styles.back} to="/market">
        ‹ 경매 목록
      </Link>
      <div className={styles.cols}>
        <div className={styles.cardCol}>
          <span className={styles.img}>{card && <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} />}</span>
          {card && (
            <Link className={styles.small} to={`/cards/${encodeURIComponent(card.id)}`}>
              카드 정보·참고 시세 보기 (포인트와는 무관)
            </Link>
          )}
        </div>
        <div className={styles.infoCol}>
          <div>
            <h1 className={styles.title}>{card ? (card.nameKo ?? card.name) : (state?.cardId ?? '경매')}</h1>
            <p className={styles.small}>
              {card ? `${card.set.nameKo} #${card.number}` : ' '} · 판매자{mine?.isSeller ? ' (나)' : ''}
            </p>
          </div>

          <section className={styles.box} aria-labelledby="bid-title">
            <h2 id="bid-title" className="visually-hidden">
              입찰
            </h2>
            {!state ? (
              <div className={styles.boxSkeleton} aria-busy="true" />
            ) : finished ? (
              <p className={styles.result} role="status">
                {result()}
              </p>
            ) : (
              <>
                <div className={styles.row}>
                  <span className={styles.small}>{state.topAmount !== null ? `현재가 · 최고 입찰 ${you(state.topAlias ?? '')}` : '시작가 · 아직 입찰이 없어요'}</span>
                  <span className={styles.small}>2초마다 확인</span>
                </div>
                <p className={styles.big}>{won(state.topAmount ?? state.startPrice)}</p>
                <div className={styles.row}>
                  <span className={timeUp || (left && left.length <= 5) ? styles.timerSoon : styles.timer}>{timeUp ? '마감 처리 중…' : `${left} 남음`}</span>
                  <span className={styles.small}>
                    {state.extensions >= state.maxExtensions ? '더 이상 연장되지 않아요' : `마감 2분 전부터 입찰이 들어오면 2분 늘어나요 (${state.extensions}/${state.maxExtensions}회)`}
                  </span>
                </div>
                {mine?.isSeller ? (
                  <div className={styles.seller}>
                    <p className={styles.small}>내 경매예요 · 입찰 {state.bidCount}건</p>
                    {state.bidCount === 0 ? (
                      <button type="button" className={styles.button} onClick={() => void cancel()}>
                        경매 취소
                      </button>
                    ) : (
                      <p className={styles.small}>입찰이 있어 취소할 수 없어요.</p>
                    )}
                  </div>
                ) : session.status === 'out' ? (
                  <Link className={styles.primary} to={`/login?${new URLSearchParams({ next: `/auctions/${id}` })}`}>
                    로그인하고 입찰하기
                  </Link>
                ) : (
                  <form
                    className={styles.bidForm}
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!timeUp && !short && !tooLow) void submit()
                    }}
                  >
                    {mine?.isTop && <p className={styles.top}>현재 최고 입찰자예요</p>}
                    <div className={styles.inputRow}>
                      <label className="visually-hidden" htmlFor="bid">
                        입찰 금액 (포인트)
                      </label>
                      <input
                        id="bid"
                        ref={input}
                        className={styles.input}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={grouped(state.minBid)}
                        value={amount}
                        disabled={timeUp}
                        aria-describedby="bid-help"
                        onChange={(e) => setAmount(grouped(digits(e.target.value)))}
                      />
                      <button type="submit" className={styles.primary} aria-disabled={timeUp || busy || !value || !!short || tooLow || undefined}>
                        {busy ? '입찰 중…' : mine?.isTop ? '올리기' : '입찰'}
                      </button>
                    </div>
                    <div className={styles.quick}>
                      <button type="button" onClick={() => setAmount(grouped(state.minBid))}>
                        최소가
                      </button>
                      <button type="button" onClick={() => setAmount(grouped((value || state.minBid - state.minStep) + state.minStep))}>
                        +100
                      </button>
                    </div>
                    <p id="bid-help" className={short || tooLow ? styles.warn : styles.small}>
                      {short
                        ? `${won(short)} 부족해요 · 출석 체크나 내 카드 판매로 모을 수 있어요`
                        : tooLow
                          ? `최소 ${won(state.minBid)}부터 입찰할 수 있어요`
                          : mine?.isTop && value > (state.topAmount ?? 0)
                            ? `내 입찰을 ${won(value)}로 올려요 (추가로 ${won(need)} 보류)`
                            : `최소 ${won(state.minBid)} (100P 단위) · 쓸 수 있는 포인트 ${available === null ? '…' : won(available)} · 입찰하면 그만큼 묶이고, 더 높은 입찰이 오면 바로 돌려받아요.`}
                    </p>
                  </form>
                )}
              </>
            )}
            {message && (
              <p className={message.ok ? styles.ok : styles.alert} role={message.ok ? 'status' : 'alert'}>
                {message.text}
              </p>
            )}
            <p className="visually-hidden" role="status">
              {live}
            </p>
          </section>

          <section aria-labelledby="history">
            <h2 id="history" className={styles.section}>
              입찰 기록 {state?.bidCount ?? 0}건
            </h2>
            {state && state.bids.length > 0 ? (
              <ol className={styles.history}>
                {state.bids.map((b, i) => (
                  <li key={i} className={mine?.myAlias === b.alias ? styles.me : undefined}>
                    <span>{you(b.alias)}</span>
                    <span>
                      {won(b.amount)} · {new Date(b.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.small}>아직 입찰이 없어요.</p>
            )}
          </section>
          <p className={styles.small}>포인트와 카드는 현금 가치가 없고, 사거나 바꿀 수 없어요. 현금 거래는 금지예요.</p>
        </div>
      </div>
    </main>
  )
}
