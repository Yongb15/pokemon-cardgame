import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { claimToday, usePoints } from '../hooks/usePoints'
import { refreshSession, signOut, useSession } from '../hooks/useSession'
import { announcePoints, won } from '../lib/points'
import styles from './Header.module.css'

const PROVIDER_LABEL = { google: '구글', kakao: '카카오', test: '테스트' } as const

/**
 * The header's right side (docs/design/auth-account.webp): a same-size placeholder while the session
 * check runs (no layout shift, and no "로그인" before we know), the sign-in link, or the user's menu.
 */
export default function AccountMenu() {
  const session = useSession()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const points = usePoints()
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const doneNote = useRef<HTMLParagraphElement>(null)
  const menuId = useId()
  const root = useRef<HTMLDivElement>(null)
  const here = pathname + search

  // Close on a click elsewhere or Esc (focus back to the button)
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A new page closes the menu
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }

  if (session.status === 'unknown') return <span className={styles.accountSkeleton} aria-hidden="true" />

  if (session.status === 'error') {
    return (
      <button type="button" className={styles.accountButton} onClick={() => void refreshSession()} title="로그인 상태를 확인하지 못했어요">
        다시 확인
      </button>
    )
  }

  if (session.status === 'out') {
    return (
      <Link className={styles.accountButton} to={`/login?${new URLSearchParams({ next: here })}`} state={{ from: here }}>
        로그인
      </Link>
    )
  }

  const { user } = session
  const summary = points.status === 'ready' ? points.summary : null
  const canClaim = !!summary && !summary.claimedToday

  const onClaim = async () => {
    setClaiming(true)
    setClaimError(null)
    const result = await claimToday()
    setClaiming(false)
    if (result.kind === 'error') setClaimError(result.message)
    else {
      if (result.kind === 'claimed') announcePoints('출석 보상 +500P 받았어요')
      // The button turns into the "done" line: keep focus inside the menu (qa 5)
      requestAnimationFrame(() => doneNote.current?.focus())
    }
  }
  const onSignOut = async () => {
    setBusy(true)
    try {
      await signOut()
      setOpen(false)
      navigate('/', { state: { notice: '로그아웃했어요.' } })
    } catch {
      // The session stays; the menu stays open so the user can try again
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={styles.account}
      ref={root}
      // Tabbing out of the menu closes it (qa 6A-6)
      onBlur={(event) => {
        // Only when focus moved somewhere else on the page: a button inside that disables itself
        // while it works drops focus to the body (relatedTarget null) and must not close it (qa P7-1)
        const to = event.relatedTarget as Node | null
        if (open && to && !root.current?.contains(to)) setOpen(false)
      }}
    >
      <button
        type="button"
        className={styles.userButton}
        aria-expanded={open}
        aria-controls={menuId}
        // Phones hide the nickname: the button still needs a name (qa 6A-1)
        aria-label={`${user.nickname} 계정 메뉴${canClaim ? ' · 출석 보상 받을 수 있어요' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {[...user.nickname][0]}
          {canClaim && <i className={styles.dot} />}
        </span>
        <span className={styles.nickname}>{user.nickname}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          <p className={styles.menuNote}>
            {user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join('·')}로 로그인함
          </p>
          {summary && (
            <div className={styles.menuPoints}>
              <p className={styles.menuBalance}>
                <span>내 포인트</span>
                <b>{won(summary.available)}</b>
              </p>
              {canClaim ? (
                <button
                  type="button"
                  className={styles.menuClaim}
                  // aria-disabled, not disabled: focus stays on it while it works (qa P7-1)
                  aria-disabled={claiming}
                  onClick={() => !claiming && void onClaim()}
                >
                  {claiming ? '받는 중…' : '출석 체크 +500P'}
                </button>
              ) : (
                <p className={styles.menuDone} ref={doneNote} tabIndex={-1}>
                  오늘 출석 완료 · 한국 시간 자정 이후 다시 받을 수 있어요
                </p>
              )}
              {claimError && (
                <p className={styles.menuError} role="alert">
                  {claimError}
                </p>
              )}
            </div>
          )}
          <hr />
          <Link to="/me">마이페이지 · 포인트 내역</Link>
          <Link to="/favorites">관심 카드</Link>
          <Link to="/collection">내 컬렉션 · 카드팩</Link>
          <hr />
          <button type="button" onClick={() => void onSignOut()} disabled={busy}>
            {busy ? '로그아웃하는 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </div>
  )
}
