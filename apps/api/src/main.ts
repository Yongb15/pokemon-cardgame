import { createApp } from './app.js'
import { PgStore, REQUIRED_PRIVILEGES } from './auth/store.js'
import { createTestProvider } from './auth/test-provider.js'
import { loadConfig } from './config.js'
import { DATA_PRIVILEGES, PgDataStore } from './data/store.js'
import { connectDatabase } from './db/client.js'

const config = loadConfig()
if (!config.proxyReady) console.warn('PROXY_SECRET is not set: every route but /health answers 401')

const database = config.DATABASE_URL ? connectDatabase(config.DATABASE_URL) : null
const store = database ? new PgStore(database.db) : null
const data = database ? new PgDataStore(database.db) : null

if (store) {
  const missing = await store.missingPrivileges([...REQUIRED_PRIVILEGES, ...DATA_PRIVILEGES])
  if (missing.length) {
    console.error(`database grants don't match this code (missing: ${missing.join(', ')}); refusing to start`)
    process.exit(1)
  }
  const excess = await store.excessPrivileges()
  if (excess.length) console.warn(`database grants wider than needed: ${excess.join(', ')}`)
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

const app = await createApp(config, { store, data, testProvider })
await app.listen(config.PORT, '0.0.0.0')
