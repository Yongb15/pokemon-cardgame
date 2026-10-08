// Settings from the environment, checked once at startup: the server refuses to start with a
// setting that would make it unsafe (docs/auth/design.md, Security review).

import { z } from 'zod'

const schema = z.object({
  APP_ENV: z.enum(['production', 'preview', 'development']),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Our site's origin: the only allowed Origin for state-changing requests, and the base of redirects */
  PUBLIC_ORIGIN: z.url(),
  /**
   * Shared with the Vercel proxy; requests without it are refused (fail closed when unset).
   * Only the generated format (base64url) passes, so a stray carriage return or a blank value stops the start (Security A-4)
   */
  PROXY_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
  AUTH_TEST_PROVIDER: z.enum(['0', '1']).default('0'),
})

export type Config = z.infer<typeof schema> & { proxyReady: boolean }

export const CONFIG = Symbol('CONFIG')

/** Keys that may come from the API_SECRETS bundle; plain settings like APP_ENV may not */
const SECRET_KEYS = new Set(['PROXY_SECRET'])

/**
 * Cloud Run gets all secrets of one environment as a single Secret Manager value (JSON) in
 * API_SECRETS: the free tier holds only 6 secret versions, so one secret per environment
 */
function withSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.API_SECRETS) return env
  let bundle: unknown
  try {
    bundle = JSON.parse(env.API_SECRETS)
  } catch {
    throw new Error('Invalid configuration: API_SECRETS is not JSON')
  }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Invalid configuration: API_SECRETS is not an object')
  }
  const entries = Object.entries(bundle)
  const unknown = entries.filter(([key, value]) => !SECRET_KEYS.has(key) || typeof value !== 'string')
  if (unknown.length) {
    throw new Error(`Invalid configuration: API_SECRETS ${unknown.map(([key]) => key).join(', ')}`)
  }
  const { API_SECRETS: _, ...rest } = env
  return { ...rest, ...Object.fromEntries(entries) }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(withSecrets(env))
  if (!parsed.success) {
    // Names only: values can be secrets
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ')
    throw new Error(`Invalid configuration: ${fields}`)
  }
  const config = parsed.data
  // The test login exists for previews only (Security): production refuses to start with it on
  if (config.AUTH_TEST_PROVIDER === '1' && config.APP_ENV !== 'preview') {
    throw new Error('AUTH_TEST_PROVIDER is only allowed when APP_ENV=preview')
  }
  return { ...config, proxyReady: !!config.PROXY_SECRET }
}
