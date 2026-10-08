// GET /api/cards/:id/prices?range=30d|90d — a card's prices by edition (docs/price/design.md §4).
//
// Order (Security review): unknown ids get a 404 before any database or outside call; `range` is
// the only parameter read; the response is built from what's stored; then, if the card's prices
// are a day old, one request claims the refresh, takes from the daily budget and fetches after the
// response (waitUntil), so the next request sees new prices.

import { addDays, isRefreshDue, utcDay, type FxRow } from './logic.js'
import { isBasicEnergy, JA_MIN_CONFIDENCE, loadPriceData, refreshCard, type CardInfo } from './refresh.js'
import { claimRefresh, getEditionLink, getFxRates, getPriceRows, getRefresh, recordView, takeBudget } from './store.js'
import { editionView, type Rates } from './view.js'

export const VIEW_REFRESH_BUDGET = 3000
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
  const term = card.nameKo && !card.nameKoUnofficial ? card.nameKo : card.name
  const kream = new URL(KREAM_SEARCH)
  kream.searchParams.set('keyword', term)
  const bunjang = new URL(BUNJANG_SEARCH)
  bunjang.searchParams.set('q', term)
  return { term, kream: kream.toString(), bunjang: bunjang.toString() }
}

export interface PricesContext {
  method: string
  userAgent: string | null
  now?: Date
  /** Keeps the function alive for work after the response (Vercel's waitUntil) */
  waitUntil?: (promise: Promise<unknown>) => void
}

export async function handlePrices(id: string, params: URLSearchParams, ctx: PricesContext): Promise<Response> {
  // 1. Only real cards: nothing is read or written for anything else
  if (!ID_PATTERN.test(id)) return error(404, '카드를 찾을 수 없습니다.', 'public, max-age=0, s-maxage=60')
  const data = await loadPriceData()
  const card = data.cards.get(id)
  if (!card) return error(404, '카드를 찾을 수 없습니다.', 'public, max-age=0, s-maxage=60')

  // 2. The one parameter
  const rangeParam = params.get('range') ?? '30d'
  if (!Object.hasOwn(RANGES, rangeParam)) return error(400, 'range는 30d 또는 90d여야 합니다.')
  const rangeDays = RANGES[rangeParam]

  if (isBasicEnergy(card)) return json({ card: id, hidden: true }, 200, OK_CACHE)

  const now = ctx.now ?? new Date()
  const today = utcDay(now)
  try {
    // 3. What's stored
    const [rows, fx, refresh, link] = await Promise.all([
      getPriceRows(id),
      getFxRates(addDays(today, -(rangeDays + 14))),
      getRefresh(id),
      getEditionLink(id),
    ])
    const rates: Rates = new Map()
    for (const r of fx) rates.set(r.currency, [...(rates.get(r.currency) ?? []), r as FxRow])

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

    // 4. Refresh after responding, when a day has passed (humans only, within the daily budget)
    let refreshing = false
    const human = ctx.method === 'GET' && !BOT.test(ctx.userAgent ?? '')
    if (human && data.tcgdex.has(id) && isRefreshDue(refresh?.refreshedAt ?? null, now)) {
      if ((await claimRefresh(id)) && (await takeBudget('view-refresh', today, VIEW_REFRESH_BUDGET))) {
        refreshing = true
        const work = refreshCard(id, now).catch(() => undefined)
        if (ctx.waitUntil) ctx.waitUntil(work)
        else await work
      }
    }
    if (human) await recordView(id, today).catch(() => undefined)

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
        refresh: { refreshedAt: refresh?.refreshedAt ?? null, status: refresh?.status ?? null, refreshing },
        note: '참고용 시세입니다',
      },
      200,
      OK_CACHE,
    )
  } catch {
    // Never the error itself: it can hold query or connection details
    return error(500, '시세를 불러오지 못했습니다.')
  }
}
