import { createApp } from './app.js'
import { PgStore } from './auth/store.js'
import { createTestProvider } from './auth/test-provider.js'
import { loadConfig } from './config.js'
import { connectDatabase } from './db/client.js'

const config = loadConfig()
if (!config.proxyReady) console.warn('PROXY_SECRET is not set: every route but /health answers 401')

const database = config.DATABASE_URL ? connectDatabase(config.DATABASE_URL) : null
const store = database ? new PgStore(database.db) : null

if (store) {
  const missing = await store.missingPrivileges()
  if (missing.length) {
    console.error(`database grants don't match this code (missing: ${missing.join(', ')}); refusing to start`)
    process.exit(1)
  }
}

let testProvider = null
if (config.AUTH_TEST_PROVIDER === '1') {
  // Second lock on the test sign-in (Security): it must run against the dev branch, never production
  if (!store || !(await store.isDevDatabase())) {
    console.error('AUTH_TEST_PROVIDER=1 needs the dev database (dev_marker); refusing to start')
    process.exit(1)
  }
  testProvider = await createTestProvider()
}

const app = await createApp(config, { store, testProvider })
await app.listen(config.PORT, '0.0.0.0')
