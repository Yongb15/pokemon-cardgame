// End-to-end tests (docs/release/v1.17.0-design.md §1). Two suites:
//   public  — every push/PR, against a local `vite` dev server (cards API from the repo's data; no accounts)
//   account — after a develop deploy, against the develop preview only (test sign-in, dev database)
// Nothing here can reach production: the public suite is localhost-only and the account suite's host is a
// constant checked again at start (Security E-2). No traces or video, list reporter (E-4).

import { defineConfig, devices } from '@playwright/test'
import { PREVIEW_URL } from './e2e/account/session'

const PUBLIC_URL = 'http://localhost:5181'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: 'e2e-results',
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'public',
      testMatch: 'public/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: PUBLIC_URL },
    },
    {
      name: 'account',
      testMatch: 'account/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW_URL },
    },
  ],
  // Only the public suite needs a local server; the account suite talks to the preview
  webServer: process.argv.includes('--project=account')
    ? undefined
    : { command: 'npx vite --port 5181 --strictPort', url: PUBLIC_URL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
})
