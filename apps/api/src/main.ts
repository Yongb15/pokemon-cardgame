import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
if (!config.proxyReady) console.warn('PROXY_SECRET is not set: every route but /health answers 401')
const app = await createApp(config)
await app.listen(config.PORT, '0.0.0.0')
