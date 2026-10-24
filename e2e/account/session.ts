// Shared by the account suite and its cleanup script: the one allowed target, the per-run test subjects, the
// start-of-run guard (Security E-2) and test sign-in. Never logs cookies, headers or response bodies (E-4).
import { expect, request, type APIRequestContext } from '@playwright/test'

/** The develop preview, hardcoded: no variable can point the suite elsewhere */
export const PREVIEW_URL = 'https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app'
const PRODUCTION_HOST = 'pokemon-card-dex-green.vercel.app'

export type Role = 'a' | 'b' | 'c'
export const ROLES: Role[] = ['a', 'b', 'c']

/** `e2e-<run id>-<attempt>-<role>`: unique per run and lowercase, so the sweeper can find leftovers (E-3) */
export function subject(role: Role) {
  const run = process.env.GITHUB_RUN_ID ?? process.env.E2E_RUN_ID
  if (!run || !/^[a-z0-9]{1,16}$/.test(run)) throw new Error('set E2E_RUN_ID (lowercase letters and digits) for a local run')
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1'
  if (!/^\d{1,3}$/.test(attempt)) throw new Error('bad GITHUB_RUN_ATTEMPT')
  return `e2e-${run}-${attempt}-${role}`
}

/** Refuse to run anywhere but the preview with its test sign-in on: production has no test provider */
export async function assertTarget() {
  const host = new URL(PREVIEW_URL).hostname
  if (host === PRODUCTION_HOST) throw new Error('refusing: production host')
  const probe = await request.newContext({ baseURL: PREVIEW_URL })
  try {
    const res = await probe.get(`/api/v1/auth/test/start?sub=${subject('a')}`, { maxRedirects: 0 })
    const to = res.headers()['location'] ?? ''
    if (res.status() !== 302 || new URL(to, PREVIEW_URL).pathname !== '/api/v1/auth/test/authorize') {
      throw new Error(`refusing: the test sign-in is not on (status ${res.status()})`)
    }
  } finally {
    await probe.dispose()
  }
}

/** An API context signed in as the role's test account (created on first sign-in). Origin passes the CSRF check */
export async function signIn(role: Role): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL: PREVIEW_URL, extraHTTPHeaders: { origin: PREVIEW_URL } })
  const res = await api.get(`/api/v1/auth/test/start?sub=${subject(role)}&next=/`)
  expect(res.ok()).toBe(true)
  const me = await (await api.get('/api/v1/me')).json()
  expect(me.user).not.toBeNull()
  return api
}

/** A unique idempotency key */
export const idem = (label: string) => `e2e${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
