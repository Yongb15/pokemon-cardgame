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
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.logo} href="/">
          <Logo />
          Card Dex
        </a>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <a className={styles.active} href="/" aria-current="page">
            카드
          </a>
          <span className={styles.soon}>
            세트 <span className={styles.tag}>준비 중</span>
          </span>
          <span className={styles.soon}>
            덱 빌더 <span className={styles.tag}>준비 중</span>
          </span>
        </nav>
      </div>
    </header>
  )
}
