// Settings from the environment, checked once at startup: the server refuses to start with a
// setting that would make it unsafe (docs/auth/design.md, Security review).

import { z } from 'zod'

const schema = z.object({
  APP_ENV: z.enum(['production', 'preview', 'development']),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Our site's origin: the only allowed Origin for state-changing requests, and the base of redirects */
  PUBLIC_ORIGIN: z.url(),
  /** Shared with the Vercel proxy; requests without it are refused (fail closed when unset) */
  PROXY_SECRET: z.string().min(32).optional(),
  AUTH_TEST_PROVIDER: z.enum(['0', '1']).default('0'),
})

export type Config = z.infer<typeof schema> & { proxyReady: boolean }

export const CONFIG = Symbol('CONFIG')

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
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
