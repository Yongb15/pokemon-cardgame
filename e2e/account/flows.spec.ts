// Signed-in flows on the develop preview (docs/release/v1.17.0-design.md §1b), with three test accounts:
// a (seller), b (bidder, then outbid), c (outbids b). The accounts are deleted by cleanup.ts afterwards.
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { watchConsole } from '../console'
import { assertTarget, idem, signIn } from './session'

test.describe.configure({ mode: 'serial' })

let a: APIRequestContext
let b: APIRequestContext
let c: APIRequestContext

test.beforeAll(async () => {
  await assertTarget()
  ;[a, b, c] = [await signIn('a'), await signIn('b'), await signIn('c')]
  // Leftovers of cancelled runs (over two hours old) go first
  const sweep = await a.post('/api/v1/test/auctions/sweep-e2e')
  expect(sweep.status()).toBe(200)
  expect(typeof (await sweep.json()).deleted).toBe('number')
})

test.afterAll(async () => {
  await Promise.all([a, b, c].map((api) => api?.dispose()))
})

/** A browser page signed in as the same account as `api` */
async function pageAs(browser: Browser, api: APIRequestContext) {
  const context = await browser.newContext({ storageState: await api.storageState() })
  const page = await context.newPage()
  return { page, problems: watchConsole(page, { local: false }) }
}

const available = async (api: APIRequestContext) => (await (await api.get('/api/v1/me/points')).json()).available as number

async function waitForPoints(api: APIRequestContext, check: (n: number) => boolean) {
  await expect.poll(async () => check(await available(api)), { timeout: 15_000 }).toBe(true)
}

test('daily check-in from the header', async ({ browser }) => {
  const { page, problems } = await pageAs(browser, a)
  await page.goto('/')
  await page.getByRole('button', { name: '출석 체크 +500P' }).click()
  await expect(page.getByText('출석 보상 +500P 받았어요')).toBeVisible()
  expect((await (await a.get('/api/v1/me/points')).json()).claimedToday).toBe(true)
  expect(problems).toEqual([])
})

test('one pack and ten packs, each card recorded with its pack', async ({ browser }) => {
  expect((await a.post('/api/v1/test/points', { data: { amount: 20_000, idemKey: idem('topup') } })).ok()).toBe(true)
  const { page, problems } = await pageAs(browser, a)
  await page.goto('/packs')
  await page.getByRole('button', { name: / 팩 열기, / }).first().click()
  await expect(page.getByRole('heading', { name: '팩 결과' })).toBeVisible()
  await page.getByRole('button', { name: / 10팩 열기, / }).first().click()
  await expect(page.getByRole('heading', { name: /^10팩 결과 · 50장/ })).toBeVisible()
  const check = await (await a.get('/api/v1/test/pack-check')).json()
  expect(check.mine).toEqual({ packs: 11, mismatched: 0 })
  expect(problems).toEqual([])
})

test('exchange a duplicate, then craft a missing card', async ({ browser }) => {
  const { page, problems } = await pageAs(browser, a)
  await page.goto('/collection')
  const before = await available(a)
  await page.getByRole('button', { name: /교환, 1장에/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /장 교환하기$/ }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await waitForPoints(a, (n) => n > before)

  const afterExchange = await available(a)
  await page.getByRole('list', { name: '세트별 모은 카드' }).getByRole('button', { expanded: false }).first().click()
  await page.getByRole('button', { name: /^만들기 / }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /로 만들기$/ }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await waitForPoints(a, (n) => n < afterExchange)
  expect(problems).toEqual([])
})

test('a deck made while signed in is saved to the account', async ({ browser }) => {
  const { page, problems } = await pageAs(browser, a)
  const count = async () => ((await (await a.get('/api/v1/decks')).json()).decks as unknown[]).length
  const before = await count()
  await page.goto('/decks')
  await page.getByRole('button', { name: '텍스트로 가져오기' }).click()
  await page.getByLabel('덱 목록').fill('Pokémon: 4\n4 Charmander PAF 7')
  await page.getByRole('button', { name: '새 덱으로 가져오기' }).click()
  await expect(page).toHaveURL(/\/decks\/[^/]+$/)
  await expect.poll(count, { timeout: 15_000 }).toBe(before + 1)
  expect(problems).toEqual([])
})

test('auction: bid, outbid notice, and no names or member codes on either side (A-3)', async ({ browser }) => {
  // a lists a card from its packs (test copies can't be listed)
  const { cards } = await (await a.get('/api/v1/me/collection')).json()
  const card = (cards as { cardId: string; test: boolean; listed: number }[]).find((x) => !x.test && !x.listed)
  expect(card).toBeTruthy()
  const listed = await a.post('/api/v1/me/auctions', { data: { cardId: card!.cardId, startPrice: 100, duration: '5m', idemKey: idem('list') } })
  expect(listed.status()).toBe(201)
  const { auctionId } = await listed.json()
  for (const api of [b, c]) expect((await api.post('/api/v1/test/points', { data: { amount: 5_000, idemKey: idem('topup') } })).ok()).toBe(true)

  // b bids on the auction page
  const buyer = await pageAs(browser, b)
  await buyer.page.goto(`/auctions/${auctionId}`)
  await buyer.page.getByLabel('입찰 금액 (포인트)').fill('100')
  await buyer.page.getByRole('button', { name: '입찰', exact: true }).click()
  await expect(buyer.page.getByText('현재 최고 입찰자예요').first()).toBeVisible()

  // c outbids b; b is told
  const outbid = await c.post(`/api/v1/me/auctions/${auctionId}/bids`, { data: { amount: 200, idemKey: idem('bid') } })
  expect((await outbid.json()).result.kind).toBe('ok')
  await buyer.page.goto('/notifications')
  await expect(buyer.page.locator('main')).toContainText('더 높은 입찰이 들어왔어요')

  // Nobody's nickname or member code shows on the bidder's, seller's or notification views
  const secrets: string[] = []
  for (const api of [a, b, c]) {
    secrets.push((await (await api.get('/api/v1/me')).json()).user.nickname)
    const code = (await (await api.get('/api/v1/me/summary')).json()).memberCode
    if (code) secrets.push(code)
  }
  const seller = await pageAs(browser, a)
  const views: [Page, string][] = [
    [buyer.page, '/notifications'],
    [buyer.page, `/auctions/${auctionId}`],
    [seller.page, `/auctions/${auctionId}`],
  ]
  for (const [page, path] of views) {
    await page.goto(path)
    await expect(page.locator('main')).toContainText('200P')
    const text = await page.locator('main').innerText()
    for (const s of secrets) expect(text.includes(s), `${path} shows an account name or code`).toBe(false)
  }
  expect(buyer.problems).toEqual([])
  expect(seller.problems).toEqual([])
})

test('every point ledger still adds up', async () => {
  for (const api of [a, b, c]) {
    const check = await (await api.get('/api/v1/test/ledger-check')).json()
    expect(check.mine.ok).toBe(true)
    expect(check.all.mismatched).toBe(0)
    expect(check.all.overHeld).toBe(0)
  }
})
