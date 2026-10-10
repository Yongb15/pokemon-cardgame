// The signed-in user's points (docs/design/points-7a.webp): loaded once per session (the first look
// grants the one-time bonus), refreshed after a check-in. Signed out, there is nothing.

import { useSyncExternalStore } from 'react'
import { AccountApiError, claimDaily, getPoints, type PointsSummary } from '../api/account'
import { onSessionChange, type Session } from './useSession'

export type Points =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: PointsSummary }

let state: Points = { status: 'idle' }
let signedIn = false
const listeners = new Set<() => void>()

function set(next: Points) {
  state = next
  for (const listener of listeners) listener()
}

/** A summary another call already returned (a pack opening): no extra request */
export function setPointsSummary(summary: PointsSummary) {
  set({ status: 'ready', summary })
}

export async function loadPoints() {
  if (state.status !== 'ready') set({ status: 'loading' })
  try {
    set({ status: 'ready', summary: await getPoints() })
  } catch (error) {
    if (state.status !== 'ready') set({ status: 'error', message: error instanceof AccountApiError ? error.message : '포인트를 불러오지 못했어요.' })
  }
}

let claiming: Promise<ClaimResult> | null = null
export type ClaimResult = { kind: 'claimed' } | { kind: 'already' } | { kind: 'error'; message: string }

/** Today's check-in. One at a time: a double click shares the first request (qa: no double submit) */
export function claimToday(): Promise<ClaimResult> {
  claiming ??= (async (): Promise<ClaimResult> => {
    try {
      const { claimed, ...summary } = await claimDaily()
      set({ status: 'ready', summary })
      return claimed ? { kind: 'claimed' } : { kind: 'already' }
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 429) {
        return { kind: 'error', message: `요청이 많아요. ${error.retryAfter ?? 60}초 뒤에 다시 눌러 주세요.` }
      }
      return { kind: 'error', message: error instanceof AccountApiError ? error.message : '출석 보상을 받지 못했어요. 잠시 후 다시 시도해 주세요.' }
    } finally {
      claiming = null
    }
  })()
  return claiming
}

onSessionChange((session: Session) => {
  if (session.status === 'in' && !signedIn) {
    signedIn = true
    void loadPoints()
  } else if (session.status === 'out' && signedIn) {
    signedIn = false
    set({ status: 'idle' })
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePoints() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
