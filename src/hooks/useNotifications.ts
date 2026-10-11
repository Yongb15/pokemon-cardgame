// The signed-in user's auction notifications (docs/design/notify-7d.webp): loaded at sign-in, then
// every minute while the tab is visible and again when it comes back. Signed out, there is nothing.

import { useSyncExternalStore } from 'react'
import { getNotifications, markNotificationsRead, type NotificationItem } from '../api/account'
import { onSessionChange, type Session } from './useSession'

export type Notifications =
  | { status: 'idle' | 'loading' }
  | { status: 'error' }
  | { status: 'ready'; unread: number; items: NotificationItem[] }

const EVERY_MS = 60_000

let state: Notifications = { status: 'idle' }
let signedIn = false
let timer: ReturnType<typeof setInterval> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Notifications) {
  state = next
  for (const listener of listeners) listener()
}

export function loadNotifications(): Promise<void> {
  loading ??= (async () => {
    if (state.status !== 'ready') set({ status: 'loading' })
    try {
      const { unread, items } = await getNotifications()
      if (signedIn) set({ status: 'ready', unread, items })
    } catch {
      // A missed poll keeps what we had; the next one tries again
      if (state.status !== 'ready') set({ status: 'error' })
    } finally {
      loading = null
    }
  })()
  return loading
}

/** Everything shown is now read: the badge clears at once, the list keeps its "new" marks until reloaded */
export async function markAllRead() {
  if (state.status !== 'ready' || state.unread === 0) return
  set({ ...state, unread: 0 })
  try {
    await markNotificationsRead()
  } catch {
    // The next poll brings the real count back
  }
}

function onVisible() {
  if (document.visibilityState === 'visible' && signedIn) void loadNotifications()
}

onSessionChange((session: Session) => {
  if (session.status === 'in' && !signedIn) {
    signedIn = true
    void loadNotifications()
    // Background tabs don't poll (design: no requests nobody sees)
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifications()
    }, EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
  } else if (session.status === 'out' && signedIn) {
    signedIn = false
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
    set({ status: 'idle' })
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNotifications() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
