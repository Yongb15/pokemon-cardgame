import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { loadNotifications, markAllRead, useNotifications } from '../hooks/useNotifications'
import { useSession } from '../hooks/useSession'
import NotificationList from './NotificationList'
import styles from './NotificationBell.module.css'

/**
 * The bell beside the account button above 900px (docs/design/notify-7d.webp ①): the unread count,
 * and the newest 20 in a popover. Opening it marks them read. Narrower screens use the account menu.
 */
export default function NotificationBell() {
  const session = useSession()
  const notes = useNotifications()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { pathname } = useLocation()

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

  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }

  if (session.status !== 'in') return null
  const ready = notes.status === 'ready' ? notes : null
  const unread = ready?.unread ?? 0

  const toggle = async () => {
    if (open) return setOpen(false)
    setOpen(true)
    // Fresh items first, then they count as seen
    await loadNotifications()
    void markAllRead()
  }

  return (
    <div
      className={styles.root}
      ref={root}
      onBlur={(event) => {
        const to = event.relatedTarget as Node | null
        if (open && to && !root.current?.contains(to)) setOpen(false)
      }}
    >
      <button
        type="button"
        className={styles.bell}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? `알림 ${unread}개 안 읽음` : '알림'}
        onClick={() => void toggle()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} className={styles.panel} role="region" aria-label="알림">
          <p className={styles.head}>
            <b>알림</b>
            <small>열면 읽음으로 바뀌어요</small>
          </p>
          <div className={styles.scroll}>
            {ready ? (
              <NotificationList items={ready.items} onPick={() => setOpen(false)} />
            ) : notes.status === 'error' ? (
              <p className={styles.note}>알림을 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>
            ) : (
              <p className={styles.note}>불러오는 중…</p>
            )}
          </div>
          <Link className={styles.foot} to="/market?tab=mine" onClick={() => setOpen(false)}>
            내 경매 보기
          </Link>
        </div>
      )}
    </div>
  )
}
