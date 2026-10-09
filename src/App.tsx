import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router'
import Footer from './components/Footer'
import Header from './components/Header'
import { useSession } from './hooks/useSession'
import styles from './App.module.css'

/**
 * Page-level messages: one handed over by navigate() (logged out, left…), or a session that ended
 * while the user was here (expired, or signed out on another device: qa)
 */
function Notices() {
  const { state, pathname, search } = useLocation()
  const session = useSession()
  const notice = (state as { notice?: unknown } | null)?.notice
  return (
    <>
      {typeof notice === 'string' && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {session.status === 'out' && session.expired && (
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
