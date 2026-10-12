// Card texts in Korean (our translation) or the English original: one choice for the whole site,
// remembered in this browser. Storage can be missing or blocked: then it's Korean each visit.

import { useSyncExternalStore } from 'react'

const KEY = 'card-dex:card-text'
let original = (() => {
  try {
    return localStorage.getItem(KEY) === 'en'
  } catch {
    return false
  }
})()
const listeners = new Set<() => void>()

export function setOriginalText(next: boolean) {
  original = next
  try {
    localStorage.setItem(KEY, next ? 'en' : 'ko')
  } catch {
    // not remembered: fine
  }
  for (const listener of listeners) listener()
}

/** true: show the English original instead of our Korean translation */
export function useOriginalText() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => original,
    () => false,
  )
}
