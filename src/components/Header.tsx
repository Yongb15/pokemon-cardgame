import { Link, useLocation } from 'react-router'
import AccountMenu from './AccountMenu'
import PointsBar, { PointsNotice } from './PointsBar'
import styles from './Header.module.css'

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="#fff" stroke="#09090b" strokeWidth="2" />
      <path d="M1.5 14a12.5 12.5 0 0 1 25 0z" fill="#e3350d" stroke="#09090b" strokeWidth="2" />
      <circle cx="14" cy="14" r="4" fill="#fff" stroke="#09090b" strokeWidth="2" />
    </svg>
  )
}

export default function Header() {
  const { pathname } = useLocation()
  const onCards = pathname === '/' || pathname.startsWith('/cards/')
  const onDecks = pathname === '/decks' || pathname.startsWith('/decks/')
  const onPrices = pathname === '/prices'
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.logo} to="/">
          <Logo />
          <span className={styles.logoText}>Card Dex</span>
        </Link>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <Link className={onCards ? styles.active : undefined} to="/" aria-current={onCards ? 'page' : undefined}>
            카드
          </Link>
          <Link className={onPrices ? styles.active : undefined} to="/prices" aria-current={onPrices ? 'page' : undefined}>
            시세
          </Link>
          <Link className={onDecks ? styles.active : undefined} to="/decks" aria-current={onDecks ? 'page' : undefined}>
            덱 빌더
          </Link>
        </nav>
        <div className={styles.right}>
          <PointsBar />
          <AccountMenu />
        </div>
      </div>
      <PointsNotice />
    </header>
  )
}
