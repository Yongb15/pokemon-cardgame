import { useEffect, useState } from 'react'
import { Link, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router'
import Footer from './components/Footer'
import Header from './components/Header'
import { useSession } from './hooks/useSession'
import styles from './App.module.css'

/**
 * Page-level messages: one handed over by navigate() (logged out, left…), or a session that ended
 * while the user was here (expired, or signed out on another device: qa)
 */
function Notices() {
  const { state, pathname, search, key } = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const [notice, setNotice] = useState<{ text: string; key: string } | null>(null)
  const handed = (state as { notice?: unknown } | null)?.notice

  // Keep it here, then take it out of the history entry, so a reload or Back doesn't show it again (qa 6A-5)
  if (typeof handed === 'string' && notice?.key !== key) setNotice({ text: handed, key })
  useEffect(() => {
    if (typeof handed !== 'string') return
    const rest = { ...(state as Record<string, unknown>) }
    delete rest.notice
    navigate(pathname + search, { replace: true, state: Object.keys(rest).length ? rest : null })
  }, [handed, state, pathname, search, navigate])

  // It belongs to the page it was shown on
  const [shownOn, setShownOn] = useState(pathname)
  if (shownOn !== pathname) {
    setShownOn(pathname)
    if (notice) setNotice(null)
  }

  return (
    <>
      {notice && (
        <p className={styles.notice} role="status">
          {notice.text}
        </p>
      )}
      {/* Not on the sign-in page itself: it would point back at itself (qa 6A-4) */}
      {session.status === 'out' && session.expired && pathname !== '/login' && (
        <p className={styles.expired} role="alert">
          로그인이 만료됐어요. 이 화면에서 고치던 내용은 그대로 있어요.{' '}
          <Link to={`/login?${new URLSearchParams({ next: pathname + search })}`}>다시 로그인</Link>
        </p>
      )}
    </>
  )
}

/** Shared page frame for every route */
function App() {
  return (
    <>
      <Header />
      <Notices />
      <Outlet />
      <Footer />
      <ScrollRestoration />
    </>
  )
}

export default App
