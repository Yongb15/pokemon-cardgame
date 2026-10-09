// Who is signed in, shared by the header and the account pages. The check runs in the background
// after the page renders and never blocks it (the API server may take 1–3 s to wake up: qa).
// 'unknown' until it answers; 'error' when it couldn't, which is not the same as signed out.

import { useSyncExternalStore } from 'react'
import { getMe, logout, setSignedOutHandler, type AccountUser } from '../api/account'

export type Session =
  | { status: 'unknown' }
  | { status: 'error' }
  | { status: 'out'; expired: boolean }
  | { status: 'in'; user: AccountUser }

let session: Session = { status: 'unknown' }
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Session) {
  session = next
  for (const listener of listeners) listener()
}

/** Ask the API again (on start, after a retry, after changing the nickname) */
export function refreshSession() {
  pending ??= getMe()
    .then(({ user }) => set(user ? { status: 'in', user } : { status: 'out', expired: false }))
    .catch(() => set({ status: 'error' }))
    .finally(() => {
      pending = null
    })
  return pending
}

export function setSessionUser(user: AccountUser) {
  set({ status: 'in', user })
}

/** Signed out here (logout, leaving, signing out everywhere) */
export function clearSession() {
  set({ status: 'out', expired: false })
}

// A 401 from a signed-in route: the session ended somewhere else (qa: "로그인이 만료됐어요")
setSignedOutHandler(() => {
  if (session.status === 'in') set({ status: 'out', expired: true })
})

export async function signOut() {
  await logout()
  clearSession()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (session.status === 'unknown' && !pending) void refreshSession()
  return () => listeners.delete(listener)
}

export function useSession() {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => session,
  )
}
