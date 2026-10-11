// The signed-in user's price alerts (docs/price/alerts.md): loaded once at sign-in, kept in step with
// saves and deletes. Signed out, there are none.

import { useSyncExternalStore } from 'react'
import { deletePriceAlert, getPriceAlerts, savePriceAlert, type PriceAlert } from '../api/account'
import { onSessionChange, type Session } from './useSession'

export type PriceAlerts = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; alerts: PriceAlert[] }

let state: PriceAlerts = { status: 'idle' }
let signedIn = false
const listeners = new Set<() => void>()

function set(next: PriceAlerts) {
  state = next
  for (const listener of listeners) listener()
}

export async function loadPriceAlerts() {
  if (state.status !== 'ready') set({ status: 'loading' })
  try {
    const { alerts } = await getPriceAlerts()
    if (signedIn) set({ status: 'ready', alerts })
  } catch {
    if (state.status !== 'ready') set({ status: 'error' })
  }
}

/** Saves (and re-arms) one alert; returns the card's current price in won, if it has one */
export async function saveAlert(cardId: string, targetKrw: number) {
  const { alert, krw } = await savePriceAlert(cardId, targetKrw)
  const rest = state.status === 'ready' ? state.alerts.filter((a) => a.cardId !== cardId) : []
  set({ status: 'ready', alerts: [alert, ...rest] })
  return krw
}

export async function removeAlert(cardId: string) {
  await deletePriceAlert(cardId)
  if (state.status === 'ready') set({ status: 'ready', alerts: state.alerts.filter((a) => a.cardId !== cardId) })
}

onSessionChange((session: Session) => {
  if (session.status === 'in' && !signedIn) {
    signedIn = true
    void loadPriceAlerts()
  } else if (session.status === 'out' && signedIn) {
    signedIn = false
    set({ status: 'idle' })
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePriceAlerts() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
