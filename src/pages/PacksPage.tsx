import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { AccountApiError, getLatestPack, getPackCatalog, openPack, type OpenedPack, type PackCatalog } from '../api/account'
import CardImg from '../components/CardImg'
import { useCardInfo } from '../hooks/useDecks'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { setPointsSummary, usePoints } from '../hooks/usePoints'
import { useSession } from '../hooks/useSession'
import { newRequestId, TIER_LABEL } from '../lib/packs'
import { won } from '../lib/points'
import styles from './PacksPage.module.css'

const SEEN_KEY = 'card-dex:seen-pack'
/** A pack opened in the last 10 minutes and not yet seen in this tab is shown again (qa A-2) */
const RECOVER_MS = 10 * 60 * 1000
const FLIP_MS = 250

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

function markSeen(id: string) {
  try {
    sessionStorage.setItem(SEEN_KEY, id)
  } catch {
    // shown again on a later visit within 10 minutes: harmless
  }
}

function wasSeen(id: string) {
  try {
    return sessionStorage.getItem(SEEN_KEY) === id
  } catch {
    return false
  }
}

/** One pack's five cards: flipped one by one (or all at once with reduced motion) */
/** `pack` null: opening right now — the same section with face-down slots, so nothing moves when it lands (qa B7-1) */
function Reveal({ pack, recovered, onAgain, canAgain, reasonId, busy }: { pack: OpenedPack | null; recovered: boolean; onAgain: () => void; canAgain: boolean; reasonId: string | undefined; busy: boolean }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [shown, setShown] = useState(pack && (recovered || reduced) ? 5 : 0)
  const heading = useRef<HTMLHeadingElement>(null)
  const { info } = useCardInfo(pack ? pack.cards.map((c) => c.cardId) : [])
  const done = !!pack && shown >= 5

  useEffect(() => {
    if (done || !pack) return
    const timer = setTimeout(() => setShown((n) => n + 1), FLIP_MS)
    return () => clearTimeout(timer)
  }, [shown, done, pack])

  // Done: focus the result heading, once (qa A-4)
  useEffect(() => {
    if (done) heading.current?.focus()
  }, [done])

  const label = (cardId: string) => {
    const card = info.get(cardId)
    return card ? (card.nameKo ?? card.name) : cardId
  }

  return (
    <section className={styles.result} aria-labelledby="pack-result">
      <div className={styles.resultHead}>
        <h2 id="pack-result" ref={heading} tabIndex={-1}>
          {!pack ? '팩 여는 중…' : recovered ? `마지막으로 연 팩 · ${timeOf(pack.createdAt)}` : '팩 결과'}
        </h2>
        {pack && !done && (
          <button type="button" className={styles.linkButton} onClick={() => setShown(5)}>
            모두 보기
          </button>
        )}
      </div>
      <ol className={styles.slots}>
        {(pack?.cards ?? Array.from({ length: 5 }, (_, i) => ({ cardId: '', tier: 'common' as const, rareSlot: i === 4, isNew: false }))).map((c, i) => {
          const card = info.get(c.cardId)
          const open = !!pack && i < shown
          return (
            <li key={i} className={c.rareSlot ? `${styles.slot} ${styles.rareSlot}` : styles.slot} aria-hidden={!done || undefined}>
              <div className={open ? `${styles.face} ${styles.open}` : styles.face}>
                {open && card ? (
                  <Link to={`/cards/${encodeURIComponent(card.id)}`} className={styles.faceLink}>
                    <CardImg src={card.images.small} fallback={card.images.fallbackSmall} alt="" width={245} height={342} />
                  </Link>
                ) : open ? (
                  <div className={styles.missing}>
                    <b>{c.cardId}</b>
                    <span>{TIER_LABEL[c.tier]}</span>
                  </div>
                ) : (
                  <span className={styles.back} />
                )}
                {open && c.isNew && <span className={styles.newBadge}>새 카드</span>}
              </div>
              <p className={styles.cap}>
                <b>{open ? label(c.cardId) : ' '}</b>
                <span>
                  {open ? TIER_LABEL[c.tier] : ' '}
                  {open && c.rareSlot && (
                    <>
                      {' '}
                      <span aria-hidden="true">✦</span>
                    </>
                  )}
                </span>
              </p>
            </li>
          )
        })}
      </ol>
      {/* One announcement for the whole pack, after the last card (qa A-4) */}
      <p className="visually-hidden" role="status">
        {done && pack
          ? `${pack.cards.map((c) => `${label(c.cardId)} ${TIER_LABEL[c.tier]}${c.rareSlot ? ' 레어 슬롯' : ''}${c.isNew ? ' 새 카드' : ''}`).join(', ')}`
          : ''}
      </p>
      <div className={styles.resultFoot}>
        <p className={styles.small}>{done ? '5장을 내 컬렉션에 넣었어요.' : ' '}</p>
        <div className={styles.actions}>
          <Link className={styles.button} to="/collection">
            컬렉션 보기
          </Link>
          <button
            type="button"
            className={styles.primary}
            aria-disabled={!canAgain || busy || !pack || undefined}
            aria-describedby={canAgain ? undefined : reasonId}
            onClick={() => canAgain && !busy && pack && onAgain()}
          >
            {busy ? '여는 중…' : '한 팩 더 (1,000P)'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** /packs (docs/design/packs-7b.webp ①–③): pick a set, open a pack, see what came out */
export default function PacksPage() {
  const session = useSession()
  const points = usePoints()
  const [catalog, setCatalog] = useState<PackCatalog | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  // `fresh`: the answer to the press in progress has arrived (until then the section shows face-down slots)
  const [pack, setPack] = useState<{ pack: OpenedPack; recovered: boolean; fresh: boolean } | null>(null)
  const [lastSet, setLastSet] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [oddsOf, setOddsOf] = useState<string | null>(null)
  // The request id of a press that hasn't got an answer yet: a retry sends the same one (K-2)
  const pending = useRef<{ setId: string; key: string } | null>(null)
  const signedIn = session.status === 'in'

  useEffect(() => {
    document.title = '카드팩 · Pokémon Card Dex'
    getPackCatalog()
      .then(setCatalog)
      .catch(() => setCatalogError(true))
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  // A pack whose answer was lost: shown again if recent and not yet seen here (qa A-2)
  useEffect(() => {
    if (!signedIn) return
    getLatestPack()
      .then(({ pack: last }) => {
        if (last && Date.now() - Date.parse(last.createdAt) < RECOVER_MS && !wasSeen(last.id)) {
          setPack((current) => current ?? { pack: last, recovered: true, fresh: true })
          setLastSet(last.setId)
          markSeen(last.id)
        }
      })
      .catch(() => undefined)
  }, [signedIn])

  if (session.status === 'out') return <Navigate to="/login?next=%2Fpacks" replace />

  const available = points.status === 'ready' ? points.summary.available : null
  const price = catalog?.price ?? 1000
  const short = available !== null && available < price ? price - available : 0

  const open = async (setId: string) => {
    if (busy) return
    setError(null)
    if (!pending.current || pending.current.setId !== setId) pending.current = { setId, key: newRequestId() }
    setBusy(setId)
    // The section shows up now, inside the click's input window, with face-down slots (qa B7-1)
    setPack((current) => (current ? { ...current, fresh: false } : null))
    try {
      const res = await openPack(setId, pending.current.key)
      pending.current = null
      setPointsSummary(res.points)
      markSeen(res.pack.id)
      setPack({ pack: res.pack, recovered: false, fresh: true })
      setLastSet(res.pack.setId)
    } catch (e) {
      if (e instanceof AccountApiError && e.status !== 0 && e.status < 500) pending.current = null // answered: a new press is a new request
      if (e instanceof AccountApiError && e.status === 429) setError(`${e.retryAfter ?? 60}초 뒤에 다시 열 수 있어요.`)
      else setError(e instanceof AccountApiError ? e.message : '팩을 열지 못했어요. 다시 눌러 주세요.')
      setPack((current) => (current ? { ...current, fresh: true } : null))
    } finally {
      setBusy(null)
    }
  }

  const setName = (id: string) => catalog?.sets.find((s) => s.id === id)?.nameKo ?? id

  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>카드팩</h1>
          <p className={styles.small}>
            한 팩 {won(price)} · 5장 (커먼 3 · 언커먼 1 · 레어 이상 1) ·{' '}
            <span className={styles.balance}>쓸 수 있는 포인트 {available === null ? '…' : won(available)}</span>
          </p>
        </div>
        <Link className={styles.button} to="/collection">
          내 컬렉션
        </Link>
      </div>

      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      {/* One reason line for every open button (qa B7-2) */}
      {short > 0 && (
        <p id="pack-short" className={styles.reason}>
          {won(short)} 부족해요 · 출석 체크로 모을 수 있어요
        </p>
      )}

      {(pack || busy) && (
        <Reveal
          key={busy && !pack?.fresh ? 'opening' : (pack?.pack.id ?? 'opening')}
          pack={busy && !pack?.fresh ? null : (pack?.pack ?? null)}
          recovered={!!pack?.recovered}
          busy={!!busy}
          canAgain={short === 0}
          reasonId={short ? 'pack-short' : undefined}
          onAgain={() => lastSet && void open(lastSet)}
        />
      )}

      {catalogError ? (
        <p className={styles.alert} role="alert">
          카드팩 목록을 불러오지 못했어요. 새로고침해 주세요.
        </p>
      ) : !catalog ? (
        <div className={styles.setsSkeleton} aria-busy="true" aria-label="불러오는 중" />
      ) : (
        <ul className={styles.sets}>
          {catalog.sets.map((s) => (
            <li key={s.id} className={styles.set}>
              <span className={styles.setLogo} aria-hidden="true">
                {s.nameKo}
              </span>
              <b>{s.nameKo}</b>
              <span className={styles.small}>
                {s.releaseDate.slice(0, 7).replace('-', '.')} · {s.cards}종
              </span>
              <div className={styles.setActions}>
                <button type="button" className={styles.linkButton} aria-expanded={oddsOf === s.id} onClick={() => setOddsOf(oddsOf === s.id ? null : s.id)}>
                  확률 보기
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  aria-label={`${s.nameKo} 팩 열기, ${won(price)}`}
                  aria-disabled={short > 0 || !!busy || undefined}
                  aria-describedby={short > 0 ? 'pack-short' : undefined}
                  onClick={() => short === 0 && void open(s.id)}
                >
                  {busy === s.id ? '여는 중…' : `열기 ${won(price)}`}
                </button>
              </div>
              {oddsOf === s.id && (
                <div className={styles.odds}>
                  <table>
                    <caption>{s.nameKo} · 레어 슬롯</caption>
                    <tbody>
                      {s.odds.map((o) => (
                        <tr key={o.tier}>
                          <th scope="row">
                            {TIER_LABEL[o.tier]} <span className={styles.small}>({o.cards}종)</span>
                          </th>
                          <td>{o.percent.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.small}>
                    커먼 3장·언커먼 1장은 이 세트의 커먼·언커먼(포켓몬·트레이너스)에서 같은 확률로 나와요. 같은 등급 안에서는 카드마다 같은 확률이고, 한 팩에 같은 카드가 두 번 나올 수 있어요. 없는 등급은 다른 등급에 나눠요.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.small}>
        포인트와 카드는 현금 가치가 없고, 사거나 바꿀 수 없어요. {pack ? `방금 연 세트: ${setName(pack.pack.setId)}` : ''}
      </p>
    </main>
  )
}
