// Console guard for every E2E page (Security E-6): any error fails the test, except the exact API calls the
// local dev server can't answer (no price or account database there). A CSP violation always fails.
import type { ConsoleMessage, Page } from '@playwright/test'

/** Requests that are expected to fail on the local dev server: account and price APIs */
const EXPECTED_FAILURES = [/^\/api\/v1\//, /^\/api\/prices\//, /^\/api\/cards\/[^/]+\/prices$/]

export function watchConsole(page: Page, { local }: { local: boolean }) {
  const problems: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text()
    if (/Content Security Policy|Refused to/i.test(text)) {
      problems.push(`CSP: ${text}`)
      return
    }
    if (msg.type() !== 'error') return
    const at = msg.location().url
    const path = at ? new URL(at, 'http://x').pathname : ''
    if (local && /Failed to load resource/.test(text) && EXPECTED_FAILURES.some((re) => re.test(path))) return
    problems.push(`${text} @ ${path || '?'}`)
  })
  page.on('pageerror', (error) => problems.push(`page error: ${error.name}`))
  return problems
}
