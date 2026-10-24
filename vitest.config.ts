import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// The Vite setup, minus the Playwright suites (e2e/, run by `npm run e2e:*`)
export default mergeConfig(viteConfig, defineConfig({ test: { exclude: [...configDefaults.exclude, 'e2e/**'] } }))
