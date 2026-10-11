import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import type { NotificationItem } from '../api/account'
import NotificationList from '../components/NotificationList'
import { loadNotifications, markAllRead, useNotifications } from '../hooks/useNotifications'
import { useSession } from '../hooks/useSession'
import styles from './NotificationsPage.module.css'

/** /notifications (docs/design/notify-7d.webp ③): the bell's list for narrow screens, linked from the account menu */
export default function NotificationsPage() {
  const session = useSession()
  const notes = useNotifications()
  // What was new when the page opened keeps its mark while the page is open
  const [seen, setSeen] = useState<NotificationItem[] | null>(null)

  useEffect(() => {
    document.title = '알림 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  const signedIn = session.status === 'in'
  useEffect(() => {
    if (!signedIn) return
    let live = true
    void loadNotifications().then(() => {
      if (live) void markAllRead()
    })
    return () => {
      live = false
    }
  }, [signedIn])

  const ready = notes.status === 'ready' ? notes : null
  if (ready && !seen) setSeen(ready.items)

  if (session.status === 'out') return <Navigate to="/login?next=%2Fnotifications" replace />

  // New ones arriving while open join the list (their mark from the server), the opened ones keep theirs
  const shown = ready && seen ? ready.items.map((item) => seen.find((s) => s.id === item.id && s.at === item.at) ?? item) : null

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>알림</h1>
      <div className={styles.box}>
        {shown ? (
          <NotificationList items={shown} />
        ) : notes.status === 'error' || session.status === 'error' ? (
          <p className={styles.note} role="alert">
            알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
        ) : (
          <div className={styles.skeleton} aria-busy="true" aria-label="불러오는 중" />
        )}
      </div>
    </main>
  )
}
