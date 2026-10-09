import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { refreshSession, signOut, useSession } from '../hooks/useSession'
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
    <div className={styles.account} ref={root}>
      <button
        type="button"
        className={styles.userButton}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {[...user.nickname][0]}
        </span>
        <span className={styles.nickname}>{user.nickname}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          <p className={styles.menuNote}>
            {user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join('·')}로 로그인함
          </p>
          <Link to="/me">마이페이지</Link>
          <Link to="/favorites">관심 카드</Link>
          <hr />
          <button type="button" onClick={() => void onSignOut()} disabled={busy}>
            {busy ? '로그아웃하는 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </div>
  )
}
