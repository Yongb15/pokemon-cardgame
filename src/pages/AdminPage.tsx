import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  AccountApiError,
  adminAuction,
  adminGrant,
  adminGrants,
  adminMember,
  adminModerate,
  adminReports,
  type AdminAuction,
  type AdminGrant,
  type AdminMember,
  type ReportedAuction,
  type ReportReason,
} from '../api/account'
import { useCardInfo } from '../hooks/useDecks'
import { won } from '../lib/points'
import { ago } from '../lib/notifications'
import styles from './AdminPage.module.css'

const REASON_LABEL: Record<ReportReason, string> = {
  price_manipulation: '가격 조작 의심',
  rmt: '현금 거래 유도',
  wrong_item: '카드·설명 이상',
  other: '기타',
}
const STATUS_LABEL: Record<string, string> = { open: '진행 중', sold: '낙찰', unsold: '유찰', cancelled: '취소됨' }

/** Anyone who isn't an admin with a recent sign-in gets the API's 404: say only that */
function NotAvailable() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>페이지를 찾을 수 없어요</h1>
      <p className={styles.small}>관리자라면 다시 로그인한 뒤 열어 주세요. 관리자 작업은 로그인 후 12시간 안에만 할 수 있어요.</p>
    </main>
  )
}

/** /admin (docs/design/moderation.webp ②): auctions with open reports, oldest first */
export function AdminReportsPage() {
  const [list, setList] = useState<ReportedAuction[] | null | 'none'>(null)
  const { info } = useCardInfo(list && list !== 'none' ? list.map((a) => a.cardId) : [])
  useEffect(() => {
    adminReports()
      .then((r) => {
        document.title = '신고 확인 · Pokémon Card Dex'
        setList(r.auctions)
      })
      .catch(() => setList('none'))
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])
  if (list === 'none') return <NotAvailable />
  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <h1 className={styles.title}>신고 확인</h1>
      <p className={styles.small}>
        <Link to="/admin/points">포인트 지급 ›</Link>
      </p>
      {!list ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
      ) : list.length === 0 ? (
        <p className={styles.small}>열린 신고가 없어요.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">경매</th>
                <th scope="col">상태</th>
                <th scope="col">신고</th>
                <th scope="col">사유</th>
                <th scope="col">첫 신고</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const card = info.get(a.cardId)
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/admin/auctions/${a.id}`}>{card ? (card.nameKo ?? card.name) : a.cardId}</Link>
                    </td>
                    <td>
                      {STATUS_LABEL[a.status] ?? a.status} · {won(a.price)}
                    </td>
                    <td>{a.reports}</td>
                    <td>
                      {Object.entries(a.reasons)
                        .map(([r, n]) => `${REASON_LABEL[r as ReportReason] ?? r} ${n}`)
                        .join(' · ')}
                    </td>
                    <td>{ago(a.firstAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

/** /admin/auctions/:id (③): bids with admin-only pseudonyms, reports, and the two actions */
export function AdminAuctionPage() {
  const { id = '' } = useParams()
  const [auction, setAuction] = useState<AdminAuction | null | 'none'>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const { info } = useCardInfo(auction && auction !== 'none' ? [auction.cardId] : [])

  const load = () =>
    adminAuction(id)
      .then((r) => setAuction(r.auction))
      .catch(() => setAuction('none'))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (auction === 'none') return <NotAvailable />
  if (!auction) return <main className={styles.main}><div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" /></main>

  const card = info.get(auction.cardId)
  const act = async (action: 'dismiss' | 'remove') => {
    if (busy || !reason.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      await adminModerate(id, action, reason.trim())
      setMessage({ ok: true, text: action === 'remove' ? '경매를 내렸어요.' : '신고를 닫았어요.' })
      setReason('')
      await load()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof AccountApiError ? e.message : '처리하지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <Link className={styles.back} to="/admin">
        ‹ 신고 확인
      </Link>
      <h1 className={styles.title}>
        {card ? (card.nameKo ?? card.name) : auction.cardId}{' '}
        <small>
          {STATUS_LABEL[auction.status] ?? auction.status} · 시작 {won(auction.startPrice)}
          {auction.topAmount !== null ? ` · 현재 ${won(auction.topAmount)}` : ''} · 판매자 {auction.seller.pseudonym ?? '—'}
        </small>
      </h1>

      <section className={styles.box} aria-labelledby="bids-title">
        <h2 id="bids-title">입찰 {auction.bidCount}</h2>
        <p className={styles.small}>U-로 시작하는 표시는 관리자에게만 보이는 사용자 구분값이에요(경매가 달라도 같은 사람이면 같음).</p>
        <table className={styles.table}>
          <tbody>
            {auction.bids.map((b, i) => (
              <tr key={i}>
                <td>{b.alias}</td>
                <td>{b.pseudonym ?? '—'}</td>
                <td>{won(b.amount)}</td>
                <td>{new Date(b.at).toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.box} aria-labelledby="reports-title">
        <h2 id="reports-title">신고 {auction.reports.length}</h2>
        <table className={styles.table}>
          <tbody>
            {auction.reports.map((r) => (
              <tr key={r.reporter}>
                <td>{r.reporter}</td>
                <td>{REASON_LABEL[r.reason]}</td>
                {/* Plain React text, never HTML (Security AD-3) */}
                <td>{r.note ?? ''}</td>
                <td>{r.status === 'open' ? '열림' : r.status === 'dismissed' ? '닫음' : '조치함'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.box} aria-labelledby="act-title">
        <h2 id="act-title">조치</h2>
        <label className={styles.field}>
          <span>이유 (필수, 기록에 남아요 · 개인정보는 적지 않기)</span>
          <input className={styles.input} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.button} aria-disabled={busy || !reason.trim() || undefined} onClick={() => void act('dismiss')}>
            신고 닫기 (문제 없음)
          </button>
          {auction.status === 'open' && (
            <button type="button" className={styles.danger} aria-disabled={busy || !reason.trim() || undefined} onClick={() => void act('remove')}>
              경매 내리기 (입찰 취소·포인트 돌려줌)
            </button>
          )}
        </div>
        <div className={styles.feedback}>
          {message && (
            <p className={message.ok ? styles.ok : styles.alert} role={message.ok ? 'status' : 'alert'}>
              {message.text}
            </p>
          )}
        </div>
        {auction.actions.length > 0 && (
          <ul className={styles.log}>
            {auction.actions.map((a, i) => (
              <li key={i}>
                {a.action === 'remove' ? '내림' : '신고 닫음'} · {a.reason} · {new Date(a.at).toLocaleString('ko-KR')}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

const GRANT_MAX = 100_000
const GRANT_DAILY_MAX = 500_000
/** "7F3A9C21" → "7F3A-9C21" */
const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

/**
 * /admin/points (docs/auction/admin-points.md): find a member by the code from their /me, check the
 * nickname they gave, then grant 1–100,000P with a reason. Grants only; 500,000P a day per admin.
 */
export function AdminPointsPage() {
  const [grants, setGrants] = useState<AdminGrant[] | null | 'none'>(null)
  const [code, setCode] = useState('')
  const [member, setMember] = useState<AdminMember | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  // One key per confirmation: a retried click is the same grant, a new confirmation a new one (G-2)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const loadGrants = () =>
    adminGrants()
      .then((r) => setGrants(r.grants))
      .catch(() => setGrants('none'))
  useEffect(() => {
    document.title = '포인트 지급 · Pokémon Card Dex'
    void loadGrants()
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  if (grants === 'none') return <NotAvailable />

  const points = Number(amount)
  const amountOk = /^\d+$/.test(amount) && points >= 1 && points <= GRANT_MAX
  const ready = !!member && amountOk && reason.trim().length > 0 && !busy

  const lookUp = async () => {
    if (busy) return
    setMessage(null)
    setMember(null)
    setConfirming(null)
    try {
      setMember((await adminMember(code.trim())).member)
    } catch (e) {
      setMessage({ ok: false, text: e instanceof AccountApiError ? e.message : '찾지 못했어요.' })
    }
  }

  const send = async () => {
    if (!member || !confirming || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await adminGrant({ code: member.code, amount: points, reason: reason.trim(), idemKey: confirming })
      setMessage({ ok: true, text: `${member.nickname}에게 ${won(points)}를 지급했어요.` })
      setAmount('')
      setReason('')
      setConfirming(null)
      await loadGrants()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof AccountApiError ? e.message : '지급하지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <Link className={styles.back} to="/admin">
        ‹ 신고 확인
      </Link>
      <h1 className={styles.title}>포인트 지급</h1>
      <p className={styles.small}>
        사용자가 마이페이지의 회원 코드와 닉네임을 알려 주면, 코드로 찾은 닉네임이 같은지 확인한 뒤 지급해요. 지급만 할 수
        있고 되돌릴 수 없어요. 한 번에 {won(GRANT_MAX)}, 하루 {won(GRANT_DAILY_MAX)}까지예요.
      </p>

      <section className={styles.box} aria-labelledby="member-title">
        <h2 id="member-title">회원 찾기</h2>
        <form
          className={styles.actions}
          onSubmit={(e) => {
            e.preventDefault()
            void lookUp()
          }}
        >
          <label className={styles.field}>
            회원 코드
            <input
              className={styles.input}
              value={code}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              placeholder="예: 7F3A-9C21"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button type="submit" className={styles.button} aria-disabled={!code.trim() || undefined}>
            찾기
          </button>
        </form>
        {member && (
          <dl className={styles.member}>
            <div>
              <dt>닉네임</dt>
              {/* Plain React text, never HTML */}
              <dd>{member.nickname}</dd>
            </div>
            <div>
              <dt>회원 코드</dt>
              <dd>{showCode(member.code)}</dd>
            </div>
            <div>
              <dt>가입일</dt>
              <dd>{new Date(member.joinedAt).toLocaleDateString('ko-KR')}</dd>
            </div>
            <div>
              <dt>구분값</dt>
              <dd>{member.pseudonym ?? '—'}</dd>
            </div>
          </dl>
        )}
      </section>

      {member && (
        <section className={styles.box} aria-labelledby="grant-title">
          <h2 id="grant-title">지급</h2>
          <label className={styles.field}>
            포인트 (1~{GRANT_MAX.toLocaleString('ko-KR')})
            <input
              className={styles.input}
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d]/g, ''))
                setConfirming(null)
              }}
            />
          </label>
          <label className={styles.field}>
            이유 (관리자 기록용, 사용자에게 보이지 않아요. 이메일·전화번호 등 개인정보는 쓰지 마세요)
            <input
              className={styles.input}
              maxLength={200}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setConfirming(null)
              }}
            />
          </label>
          {confirming ? (
            <div className={styles.confirm} role="group" aria-label="지급 확인">
              <p>
                <b>{member.nickname}</b>({showCode(member.code)})에게 <b>{won(points)}</b>를 지급할까요?
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.primary} aria-disabled={busy || undefined} onClick={() => void send()}>
                  {busy ? '지급하는 중…' : '지급'}
                </button>
                <button type="button" className={styles.button} onClick={() => setConfirming(null)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                aria-disabled={!ready || undefined}
                onClick={() => ready && setConfirming(crypto.randomUUID())}
              >
                지급하기…
              </button>
            </div>
          )}
        </section>
      )}

      <div className={styles.feedback} aria-live="polite">
        {message && <p className={message.ok ? styles.ok : styles.alert}>{message.text}</p>}
      </div>

      <section className={styles.box} aria-labelledby="recent-title">
        <h2 id="recent-title">최근 30일 지급</h2>
        {!grants ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
        ) : grants.length === 0 ? (
          <p className={styles.small}>아직 없어요.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">회원 코드</th>
                  <th scope="col">구분값</th>
                  <th scope="col">포인트</th>
                  <th scope="col">이유</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>{new Date(g.at).toLocaleString('ko-KR')}</td>
                    <td>{g.memberCode ? showCode(g.memberCode) : '(탈퇴)'}</td>
                    <td>{g.pseudonym ?? '—'}</td>
                    <td>{won(g.amount)}</td>
                    <td>{g.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
