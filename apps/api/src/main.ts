import { createApp } from './app.js'
import { PgStore, REQUIRED_PRIVILEGES } from './auth/store.js'
import { createTestProvider } from './auth/test-provider.js'
import { loadConfig } from './config.js'
import { DATA_PRIVILEGES, PgDataStore } from './data/store.js'
import { connectDatabase } from './db/client.js'
import { AUCTIONS_EXCESS, AUCTIONS_PRIVILEGES, PgAuctionsStore } from './auctions/store.js'
import { GRANTS_EXCESS, GRANTS_PRIVILEGES, PgGrantsStore } from './moderation/grants.js'
import { MODERATION_EXCESS, MODERATION_PRIVILEGES, PgModerationStore } from './moderation/store.js'
import { ALERTS_EXCESS, ALERTS_PRIVILEGES, PgAlertsStore } from './alerts/store.js'
import { NOTIFICATIONS_EXCESS, NOTIFICATIONS_PRIVILEGES, PgNotificationsStore } from './notifications/store.js'
import { exchangeFunctionCheck, PgPacksStore, PACKS_EXCESS, PACKS_PRIVILEGES } from './packs/store.js'
import { PgPointsStore, POINTS_EXCESS, POINTS_PRIVILEGES } from './points/store.js'

const config = loadConfig()
if (!config.proxyReady) console.warn('PROXY_SECRET is not set: every route but /health answers 401')

const database = config.DATABASE_URL ? connectDatabase(config.DATABASE_URL) : null
const store = database ? new PgStore(database.db) : null
const data = database ? new PgDataStore(database.db) : null
const points = database ? new PgPointsStore(database.db) : null
const packs = database ? new PgPacksStore(database.db) : null
const auctions = database ? new PgAuctionsStore(database.db) : null
const notifications = database ? new PgNotificationsStore(database.db) : null
const alerts = database ? new PgAlertsStore(database.db) : null
const moderation = database ? new PgModerationStore(database.db) : null
const grants = database ? new PgGrantsStore(database.db) : null

if (store) {
  const missing = await store.missingPrivileges([...REQUIRED_PRIVILEGES, ...DATA_PRIVILEGES, ...POINTS_PRIVILEGES, ...PACKS_PRIVILEGES, ...AUCTIONS_PRIVILEGES, ...NOTIFICATIONS_PRIVILEGES, ...ALERTS_PRIVILEGES, ...MODERATION_PRIVILEGES, ...GRANTS_PRIVILEGES])
  // The exchange function: api_rw executes it, nobody else (docs/auction/exchange.md §2, Security X-1/X-2)
  const fn = await exchangeFunctionCheck(database!.db)
  missing.push(...fn.missing)
  if (missing.length) {
    console.error(`database grants don't match this code (missing: ${missing.join(', ')}); refusing to start`)
    process.exit(1)
  }
  const excess = [...(await store.excessPrivileges()), ...(await store.grantedOf([...POINTS_EXCESS, ...PACKS_EXCESS, ...AUCTIONS_EXCESS, ...NOTIFICATIONS_EXCESS, ...ALERTS_EXCESS, ...MODERATION_EXCESS, ...GRANTS_EXCESS]))]
  excess.push(...fn.excess)
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

// Expired sessions go within the hour, whether or not anyone signs in (Security U-2)
if (store) {
  const sweep = () =>
    store.deleteExpiredSessions().catch((error: unknown) => {
      console.warn('expired-session sweep failed:', error instanceof Error ? error.name : 'unknown')
    })
  void sweep()
  setInterval(() => void sweep(), 60 * 60 * 1000).unref()
}

// Auctions nobody opened after they ended: settled at start-up and every 10 minutes while an instance
// runs (participants' own reads settle theirs at once; this only tidies the rest). One auction per
// transaction in id order, the same code as everywhere else (design §3, §4)
if (auctions) {
  const settle = () =>
    auctions.settleExpired(50).catch((error: unknown) => {
      console.warn('auction sweep failed:', error instanceof Error ? error.name : 'unknown')
    })
  void settle()
  setInterval(() => void settle(), 10 * 60 * 1000).unref()
}

// Report notes go 90 days after the report is resolved (Security AD-3), grant reasons after a year
// (R-3); daily is plenty
if (moderation) {
  const clear = async () => {
    await moderation.clearOldNotes().catch((error: unknown) => {
      console.warn('report note cleanup failed:', error instanceof Error ? error.name : 'unknown')
    })
    await grants?.clearOldReasons().catch((error: unknown) => {
      console.warn('grant reason cleanup failed:', error instanceof Error ? error.name : 'unknown')
    })
  }
  void clear()
  setInterval(() => void clear(), 24 * 60 * 60 * 1000).unref()
}

const app = await createApp(config, { store, data, points, packs, auctions, notifications, alerts, moderation, grants, testProvider })
await app.listen(config.PORT, '0.0.0.0')
