// GET /api/cards/:id/prices?range=30d|90d — a card's prices by edition (docs/price/design.md §4).
//
// Order (Security review): unknown ids get a 404 before any database or outside call; `range` is
// the only parameter read; the response is built from what's stored; then, if the card's prices
// are a day old, one request claims the refresh, takes from the daily budget and fetches after the
// response (waitUntil), so the next request sees new prices.

import { addDays, isRefreshDue, utcDay, type FxRow } from './logic.js'
import { isBasicEnergy, JA_MIN_CONFIDENCE, loadPriceData, refreshCard, type CardInfo } from './refresh.js'
import { fetchFx } from './sources.js'
import {
  budgetLeft,
  claimRefresh,
  getEditionLink,
  getFxRates,
  getPriceRows,
  getRefresh,
  recordView,
  saveFx,
  takeBudget,
} from './store.js'
import { editionView, type Rates } from './view.js'

export const VIEW_REFRESH_BUDGET = 3000
const STALE_PENDING_MS = 10 * 60 * 1000
const VIEW_REFRESH_TIMEOUT_MS = 10_000
const FX_ON_VIEW_TRIES = 3
const RANGES: Record<string, number> = { '30d': 30, '90d': 90 }
const ID_PATTERN = /^[\w.!?-]{1,40}$/

// Search pages for the Korean edition (links only: we collect nothing from them)
const KREAM_SEARCH = 'https://kream.co.kr/search'
const BUNJANG_SEARCH = 'https://m.bunjang.co.kr/search/products'

// Wizards-era sets printed 1st Edition and Unlimited; the price sources don't tell them apart (qa P2-4)
const MIXED_EDITION_SETS = new Set(['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4'])

// Crawlers, link previews and audits don't count as views and don't trigger refreshes
const BOT = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|embedly|curl|wget/i

function json(body: unknown, status: number, cache: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  })
}
const OK_CACHE = 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600'
const error = (status: number, message: string, cache = 'no-store') => json({ error: { message, code: status } }, status, cache)

/** Search words for the Korean edition: our translation would find nothing, so unofficial names search in English */
function koreanLinks(card: CardInfo) {
  const name = card.nameKo && !card.nameKoUnofficial ? card.nameKo : card.name
  // Print symbols (Prism Star ◇, Star ☆, δ species) don't help a marketplace search (qa P3-5)
  const term = name.replace(/[◇☆★δ]/gu, '').replace(/\s+/g, ' ').trim() || name
  const kream = new URL(KREAM_SEARCH)
  kream.searchParams.set('keyword', term)
  const bunjang = new URL(BUNJANG_SEARCH)
  bunjang.searchParams.set('q', term)
  return { term, kream: kream.toString(), bunjang: bunjang.toString() }
}

export interface PricesContext {
  method: string
  userAgent: string | null
  /** The browser's Sec-Fetch-Site header: only the app's own requests count as views */
  fetchSite?: string | null
  now?: Date
  /** Keeps the function alive for work after the response (Vercel's waitUntil) */
  waitUntil?: (promise: Promise<unknown>) => void
}

export async function handlePrices(id: string, params: URLSearchParams, ctx: PricesContext): Promise<Response> {
  // 1. Only real cards: nothing is read or written for anything else
  if (!ID_PATTERN.test(id)) return error(404, '카드를 찾을 수 없습니다.', 'public, max-age=0, s-maxage=60')

  // 2. The one parameter. Anything else would only make a new cache key that always reaches the
  // database, so it's refused (Security P-5)
  // (a repeated `range=…&range=…` would make new keys too: Security P-5b)
  const keys = [...params.keys()]
  if (keys.length > 1 || keys.some((key) => key !== 'range')) return error(400, '알 수 없는 파라미터입니다.')
  const rangeParam = params.get('range') ?? '30d'
  if (!Object.hasOwn(RANGES, rangeParam)) return error(400, 'range는 30d 또는 90d여야 합니다.')
  const rangeDays = RANGES[rangeParam]

  const now = ctx.now ?? new Date()
  const today = utcDay(now)
  try {
    const data = await loadPriceData()
    const card = data.cards.get(id)
    if (!card) return error(404, '카드를 찾을 수 없습니다.', 'public, max-age=0, s-maxage=60')
    if (isBasicEnergy(card)) return json({ card: id, hidden: true }, 200, OK_CACHE)

    // 3. What's stored
    const [rows, fx, refresh, link] = await Promise.all([
      getPriceRows(id),
      getFxRates(addDays(today, -(rangeDays + 14))),
      getRefresh(id),
      getEditionLink(id),
    ])
    const rates: Rates = new Map()
    for (const r of fx) rates.set(r.currency, [...(rates.get(r.currency) ?? []), r as FxRow])
    // A refresh "pending" for over 10 minutes was cut off (a timeout, a stopped run): it failed. Left
    // as pending it would keep the answer on a 15-second cache (Security, 10/10)
    const stalePending = refresh?.status === 'pending' && now.getTime() - refresh.refreshedAt.getTime() > STALE_PENDING_MS
    const refreshStatus = stalePending ? 'error' : (refresh?.status ?? null)

    const en = editionView(
      rows.filter((r) => r.edition === 'en'),
      rates,
      rangeDays,
      today,
    )
    const jaView = editionView(
      rows.filter((r) => r.edition === 'ja'),
      rates,
      rangeDays,
      today,
    )
    const jaTrusted = !!link && link.method !== 'none' && (link.verified || link.confidence >= JA_MIN_CONFIDENCE)
    const ja = !link
      ? { state: 'unlinked' as const }
      : link.method === 'none'
        ? { state: 'absent' as const }
        : !jaTrusted
          ? { state: 'checking' as const }
          : jaView.latest
            ? { state: 'ok' as const, ...jaView }
            : { state: 'noPrice' as const }

    // 4. Refresh after responding, when a day has passed (humans only, within the daily budget).
    // The budget comes before the claim: with the budget gone nothing is claimed, so the daily cron
    // still gets every card (Security P-4). A lost race only wastes one unit of the budget.
    let refreshing = false
    const human = ctx.method === 'GET' && !BOT.test(ctx.userAgent ?? '')
    if (
      human &&
      data.tcgdex.has(id) &&
      isRefreshDue(refresh?.refreshedAt ?? null, now) &&
      (await budgetLeft('view-refresh', today, VIEW_REFRESH_BUDGET)) &&
      (await takeBudget('view-refresh', today, VIEW_REFRESH_BUDGET)) &&
      (await claimRefresh(id))
    ) {
      refreshing = true
      // English and Japanese fetches together stay well inside the function's 15 s (Security Info 2)
      const work = refreshCard(id, now, AbortSignal.timeout(VIEW_REFRESH_TIMEOUT_MS)).catch(() => undefined)
      if (ctx.waitUntil) ctx.waitUntil(work)
      else await work
    }

    // No recent rate yet (a fresh database before its first daily run, or a failed run): fetch the
    // day's rates once, so prices aren't shown without won (Security note after v1.2.0)
    // Both price currencies need a recent rate; a few tries a day in case one call fails (qa)
    const recent = (currency: string) => fx.some((r) => r.currency === currency && r.usable && r.rateDate >= addDays(today, -5))
    const haveFx = recent('USD') && recent('EUR')
    if (
      human &&
      !haveFx &&
      (await budgetLeft('fx-on-view', today, FX_ON_VIEW_TRIES)) &&
      (await takeBudget('fx-on-view', today, FX_ON_VIEW_TRIES))
    ) {
      const work = fetchFx(now, AbortSignal.timeout(VIEW_REFRESH_TIMEOUT_MS))
        .then((rates) => (rates ? saveFx(rates) : undefined))
        .catch(() => undefined)
      if (ctx.waitUntil) ctx.waitUntil(work)
      else await work
    }
    // Views only from the app's own pages (Security Info 3)
    if (human && ctx.fetchSite === 'same-origin') await recordView(id, today).catch(() => undefined)

    return json(
      {
        card: id,
        range: rangeParam,
        today,
        editions: {
          en: { state: en.latest ? 'ok' : 'none', ...en },
          ja,
          ko: { state: 'links', links: koreanLinks(card) },
        },
        mixedEditions: MIXED_EDITION_SETS.has(card.set),
        // For checking from outside (qa): when we last tried, how it went, whether a fetch just started
        refresh: { refreshedAt: refresh?.refreshedAt ?? null, status: refreshStatus, refreshing },
        note: '참고용 시세입니다',
      },
      200,
      // While a refresh runs the new prices are seconds away: don't keep "fetching" for 10 minutes (qa P4-6)
      // Short too when a bot saw a card that's due: the next person should reach the function and
      // start the refresh, not get this answer from the cache for 10 minutes (qa V-2)
      // Rates missing: the answer is in original currencies until they arrive in seconds (qa)
      refreshing ||
        refreshStatus === 'pending' ||
        !haveFx ||
        (!human && isRefreshDue(refresh?.refreshedAt ?? null, now))
        ? 'public, max-age=0, s-maxage=15'
        : OK_CACHE,
    )
  } catch {
    // Never the error itself: it can hold query or connection details
    return error(500, '시세를 불러오지 못했습니다.')
  }
}
