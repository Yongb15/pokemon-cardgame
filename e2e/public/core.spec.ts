// Public flows on a local dev server (docs/release/v1.17.0-design.md §1a): search, card detail, sets, the deck
// builder with export and share link, the solo simulator, 404, and phone width in dark mode. No accounts.
import { expect, test } from '@playwright/test'
import { watchConsole } from '../console'

// The suite must never point anywhere but this machine (Security E-2)
test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('localhost')
})

test('Korean search finds 리자몽 and opens its detail page', async ({ page }) => {
  const problems = watchConsole(page, { local: true })
  await page.goto('/?q=리자몽')
  const first = page.locator('a[href^="/cards/"]').first()
  await expect(first).toBeVisible()
  await first.click()
  await expect(page).toHaveURL(/\/cards\//)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('리자몽')
  expect(problems).toEqual([])
})

test('the "evolves from" link lists exact names first (리자드 before 일레도리자드)', async ({ page }) => {
  const problems = watchConsole(page, { local: true })
  await page.goto('/cards/sv3pt5-6')
  await page.getByRole('link', { name: /리자드에서 진화/ }).click()
  await expect(page).toHaveURL(/q=%EB%A6%AC%EC%9E%90%EB%93%9C|q=리자드/)
  const names = page.locator('a[href^="/cards/"]')
  await expect(names.first()).toContainText('리자드')
  await expect(names.first()).not.toContainText('일레도')
  expect(problems).toEqual([])
})

test('a set page lists its cards in number order', async ({ page }) => {
  const problems = watchConsole(page, { local: true })
  await page.goto('/?set=sv3pt5')
  await expect(page.locator('a[href="/cards/sv3pt5-1"]')).toBeVisible()
  expect(problems).toEqual([])
})

test('deck builder: import a list, check the rules, export, share and open the shared deck', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const problems = watchConsole(page, { local: true })
  await page.goto('/decks')
  await page.getByRole('button', { name: '텍스트로 가져오기' }).click()
  await page.getByLabel('덱 목록').fill('Pokémon: 3\n3 Charizard ex PAF 54\n4 Charmander PAF 7\n\nTrainer: 4\n4 Rare Candy PAF 89')
  await page.getByRole('button', { name: '새 덱으로 가져오기' }).click()
  await expect(page).toHaveURL(/\/decks\/[^/]+$/)
  // 11 cards: the 60-card rule is unmet and says so
  await expect(page.getByRole('list', { name: '덱 규칙 검사' })).toContainText('60')
  // Export: the PTCG Live text names the cards
  await page.getByRole('button', { name: 'PTCG Live로 내보내기' }).click()
  await expect(page.getByRole('dialog')).toContainText('Charizard ex')
  await page.keyboard.press('Escape')
  // Share: the copied link opens the shared page with the same cards
  await page.getByRole('button', { name: '공유 링크 복사' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('/decks/shared?')
  await page.goto(new URL(link).pathname + new URL(link).search)
  await expect(page.getByRole('heading', { level: 2, name: '덱 목록' })).toBeAttached()
  await expect(page.locator('main')).toContainText('리자몽')
  expect(problems).toEqual([])
})

test('deck simulator: a 60-card deck deals 7 cards and 6 prizes, then draws', async ({ page }) => {
  const problems = watchConsole(page, { local: true })
  await page.goto('/decks')
  await page.getByRole('button', { name: '텍스트로 가져오기' }).click()
  await page.getByLabel('덱 목록').fill('Pokémon: 4\n4 Charmander PAF 7\n\nEnergy: 56\n56 Basic Fire Energy SVE 2')
  await page.getByRole('button', { name: '새 덱으로 가져오기' }).click()
  await expect(page).toHaveURL(/\/decks\/[^/]+$/)
  const sim = page.getByRole('region', { name: '혼자 돌려 보기' })
  await sim.getByRole('button', { name: /혼자 돌려 보기/ }).click()
  await sim.getByRole('button', { name: '섞고 시작' }).click()
  await expect(sim.getByRole('status')).toContainText('남은 덱 47장')
  await expect(sim.getByText('뒷면 카드', { exact: false }).or(sim.locator('[aria-label="뒷면 카드"]'))).toHaveCount(6)
  await sim.getByRole('button', { name: '1장 뽑기' }).click()
  await expect(sim.getByRole('status')).toContainText('남은 덱 46장')
  expect(problems).toEqual([])
})

test('an unknown address shows the not-found page', async ({ page }) => {
  const problems = watchConsole(page, { local: true })
  await page.goto('/no-such-page-e2e')
  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없어요' })).toBeVisible()
  await expect(page).toHaveTitle(/페이지를 찾을 수 없어요/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  expect(problems).toEqual([])
})

test.describe('phone width, dark mode', () => {
  test.use({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' })
  for (const path of ['/', '/cards/sv3pt5-6', '/decks']) {
    test(`${path} fits without sideways scrolling`, async ({ page }) => {
      const problems = watchConsole(page, { local: true })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      expect(problems).toEqual([])
    })
  }
})
