import { NICKNAME_MAX, NICKNAME_MIN, cleanNickname } from '@card-dex/shared'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { AccountApiError, getSummary, leave, logoutEverywhere, renameMe } from '../api/account'
import Dialog from '../components/deck/Dialog'
import PointsLedger from '../components/PointsLedger'
import { clearSession, refreshSession, setSessionUser, useSession } from '../hooks/useSession'
import styles from './AccountPages.module.css'

const PROVIDER_LABEL: Record<string, string> = { google: '구글', kakao: '카카오', test: '테스트' }

const errorText = (error: unknown) =>
  error instanceof AccountApiError ? error.message : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'

/** /me (docs/design/auth-account.webp): nickname, sign-in method, counts, sign out everywhere, leave */
export default function MyPage() {
  const session = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [summary, setSummary] = useState<{ decks: number; favorites: number } | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'rename' | 'all' | 'leave' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const signedIn = session.status === 'in'
  const currentName = signedIn ? session.user.nickname : ''
  // Starts from the current nickname even when the session was already known (qa 6A-2)
  const [nickname, setNickname] = useState(currentName)
  // Signing out from here sends the user home with a message, not to the sign-in page (qa 6A-3)
  const [signingOff, setSigningOff] = useState(false)

  useEffect(() => {
    document.title = '마이페이지 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  // The form starts from the current nickname (and follows it after a save)
  const [shownName, setShownName] = useState(currentName)
  if (shownName !== currentName) {
    setShownName(currentName)
    setNickname(currentName)
  }

  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!signedIn) return
    let live = true
    getSummary()
      .then((s) => live && (setSummary(s), setSummaryError(null)))
      .catch((error: unknown) => live && setSummaryError(errorText(error)))
    return () => {
      live = false
    }
  }, [signedIn, reload])

  if (session.status === 'out' && signingOff) return null
  if (session.status === 'out') {
    // Expired while here, or never signed in: sign in and come back
    return <Navigate to={`/login?${new URLSearchParams({ next: pathname })}`} replace />
  }

  const say = (ok: boolean, text: string) => {
    setNotice({ ok, text })
    heading.current?.focus()
  }

  const clean = cleanNickname(nickname)
  const onRename = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!clean) return
    setBusy('rename')
    try {
      const { user } = await renameMe(clean)
      setSessionUser(user)
      say(true, '닉네임을 바꿨어요.')
    } catch (error) {
      say(false, errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const onLogoutEverywhere = async () => {
    setBusy('all')
    try {
      await logoutEverywhere()
      setSigningOff(true)
      navigate('/', { state: { notice: '모든 기기에서 로그아웃했어요.' } })
      clearSession()
    } catch (error) {
      say(false, errorText(error))
      setBusy(null)
    }
  }

  return (
    <main className={styles.main}>
      <meta name="robots" content="noindex" />
      <h1 className={styles.title} ref={heading} tabIndex={-1}>
        마이페이지
      </h1>
      {notice && (
        <p className={notice.ok ? styles.notice : styles.alert} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}

      {session.status !== 'in' ? (
        session.status === 'error' ? (
          <div className={styles.alert} role="alert">
            로그인 상태를 확인하지 못했어요.{' '}
            <button type="button" className={styles.linkButton} onClick={() => void refreshSession()}>
              다시 시도
            </button>
          </div>
        ) : (
          <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : (
        <>
          <section className={styles.section} aria-labelledby="profile">
            <h2 id="profile">프로필</h2>
            <form className={styles.row} onSubmit={(e) => void onRename(e)}>
              <div>
                <label htmlFor="nickname" className={styles.rowTitle}>
                  닉네임
                </label>
                <p className={styles.small} id="nickname-hint">
                  {NICKNAME_MIN}~{NICKNAME_MAX}자. 다른 사람과 같아도 돼요.
                </p>
              </div>
              <div className={styles.inline}>
                <input
                  id="nickname"
                  className={styles.input}
                  value={nickname}
                  maxLength={NICKNAME_MAX * 2}
                  aria-describedby="nickname-hint"
                  aria-invalid={nickname !== '' && !clean ? true : undefined}
                  onChange={(e) => setNickname(e.target.value)}
                />
                <button type="submit" className={styles.primary} disabled={!clean || clean === currentName || busy !== null}>
                  {busy === 'rename' ? '저장하는 중…' : '저장'}
                </button>
              </div>
            </form>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>로그인 수단</p>
                <p className={styles.small}>구글과 카카오는 서로 다른 계정이에요.</p>
              </div>
              <span className={styles.chip}>{session.user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(' · ')}</span>
            </div>
          </section>

          <PointsLedger />

          <section className={styles.section} aria-labelledby="my-data">
            <h2 id="my-data">내 데이터</h2>
            {summaryError ? (
              <p className={styles.alert} role="alert">
                {summaryError}{' '}
                <button type="button" className={styles.linkButton} onClick={() => setReload((n) => n + 1)}>
                  다시 시도
                </button>
              </p>
            ) : (
              <dl className={styles.counts}>
                <div className={styles.row}>
                  <dt>저장한 덱</dt>
                  <dd>{summary ? <>{summary.decks}개 <span className={styles.small}>/ 100</span></> : '…'}</dd>
                </div>
                <div className={styles.row}>
                  <dt>관심 카드</dt>
                  <dd>{summary ? <>{summary.favorites}장 <span className={styles.small}>/ 500</span></> : '…'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className={styles.section} aria-labelledby="security">
            <h2 id="security">보안</h2>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>모든 기기에서 로그아웃</p>
                <p className={styles.small}>다른 기기에 로그인한 채로 두었다면 여기서 한 번에 끝낼 수 있어요.</p>
              </div>
              <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void onLogoutEverywhere()}>
                {busy === 'all' ? '로그아웃하는 중…' : '모두 로그아웃'}
              </button>
            </div>
          </section>

          <section className={`${styles.section} ${styles.danger}`} aria-labelledby="leave">
            <h2 id="leave">탈퇴</h2>
            <div className={styles.row}>
              <p className={styles.small}>계정과 덱·관심 카드가 바로 지워지고 되돌릴 수 없어요. 이 브라우저에 저장된 덱은 그대로 남아요.</p>
              <button type="button" className={styles.dangerButton} onClick={() => setLeaving(true)}>
                탈퇴하기
              </button>
            </div>
          </section>

          {leaving && (
            <LeaveDialog
              nickname={session.user.nickname}
              summary={summary}
              onClose={() => setLeaving(false)}
              onLeft={() => {
                setSigningOff(true)
                navigate('/', { state: { notice: '탈퇴했어요. 그동안 이용해 주셔서 고마워요.' } })
                clearSession()
              }}
            />
          )}
        </>
      )}
    </main>
  )
}

function LeaveDialog({
  nickname,
  summary,
  onClose,
  onLeft,
}: {
  nickname: string
  summary: { decks: number; favorites: number } | null
  onClose: () => void
  onLeft: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim() === nickname

  const onLeave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!matches) return
    setBusy(true)
    setError(null)
    try {
      await leave(typed)
      onLeft()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog title="정말 탈퇴할까요?" onClose={onClose}>
      <form className={styles.dialogForm} onSubmit={(e) => void onLeave(e)}>
        <p>
          {summary ? (
            <>
              저장한 덱 <b>{summary.decks}개</b>와 관심 카드 <b>{summary.favorites}장</b>이
            </>
          ) : (
            '저장한 덱과 관심 카드가'
          )}{' '}
          바로 지워지고 되돌릴 수 없어요.
        </p>
        <p className={styles.small}>카카오·구글 계정의 "연결된 서비스" 목록에서는 각 계정 설정에서 직접 지울 수 있어요.</p>
        <label htmlFor="leave-confirm" className={styles.rowTitle}>
          확인을 위해 닉네임 <b>{nickname}</b>을(를) 입력해 주세요
        </label>
        <input
          id="leave-confirm"
          className={styles.input}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.dangerFilled} disabled={!matches || busy}>
            {busy ? '탈퇴하는 중…' : '탈퇴하기'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
