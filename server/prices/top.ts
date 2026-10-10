// GET /api/prices/top?edition=en|ja|psa10&set=<set id> — the priciest cards right now (docs/design/price-ranking.webp,
// docs/design/psa-prices.webp ③). `psa10` ranks the collected PSA 10 medians: the only list of PSA
// values we serve, capped at 50 (Security P-1).
//
// Ranks what has been collected: every card's latest unflagged level confirmed within the last
// week, its headline price chosen as on the detail page (TCGplayer first, then normal → holo → …),
// in won at today's rate. Cards nobody has fetched yet aren't in it; the page says so. Read-only:
// no refreshes, no outside calls. Cached at the edge for an hour.

import { addDays, headlineVariant, rateOn, toKrw, utcDay, type FxRow, type Variant } from './logic.js'
import { isBasicEnergy, loadPriceData } from './refresh.js'
import { PSA_MAX_AGE_DAYS } from './psaView.js'
import { getFxRates, getLatestLevels, getLatestPsa10 } from './store.js'

export const TOP_LIMIT = 50
/** A price not confirmed for a week is too old to rank */
const FRESH_DAYS = 7
const SOURCE_ORDER = ['tcgplayer', 'cardmarket']
const SET_ID = /^[a-z0-9]{1,20}$/

export interface Level {
  cardId: string
  source: string
  variant: string
  currency: string
  market: number
  lastSeenOn: string
}

export interface Ranked {
  id: string
  krw: number
  amount: number
  currency: string
  source: string
  variant: string
  date: string
  /** PSA 10 only: the sales behind the median */
  sales?: number
}

/** A ranking median needs at least this many sales: three deals can top the list with a fluke (qa PSA-3) */
export const PSA_RANK_MIN_SALES = 5

/** The PSA 10 medians in won, priciest first (cards without a rate, or with few sales, are left out) */
export function rankPsa10(
  rows: { cardId: string; median: number; sales: number; capturedOn: string }[],
  usd: FxRow[],
  today: string,
  keep: (cardId: string) => boolean,
  limit = TOP_LIMIT,
) {
  const fx = rateOn(usd, today)
  if (!fx) return []
  const ranked: Ranked[] = []
  for (const r of rows) {
    if (!keep(r.cardId) || r.sales < PSA_RANK_MIN_SALES) continue
    const krw = toKrw(r.median, fx.krwPerUnit).krw
    if (krw === null) continue
    ranked.push({ id: r.cardId, krw, amount: r.median, currency: 'USD', source: 'psa10', variant: 'psa10', date: r.capturedOn, sales: r.sales })
  }
  return ranked.sort((a, b) => b.krw - a.krw || a.id.localeCompare(b.id)).slice(0, limit)
}

/**
 * One headline per card, in won, priciest first. Cards whose price has no rate yet (or is under
 * ₩10) are left out: a ranking can't place them.
 */
export function rank(levels: Level[], rates: Map<string, FxRow[]>, today: string, keep: (cardId: string) => boolean, limit = TOP_LIMIT) {
  const byCard = new Map<string, Level[]>()
  for (const level of levels) {
    if (!keep(level.cardId)) continue
    byCard.set(level.cardId, [...(byCard.get(level.cardId) ?? []), level])
  }
  const ranked: Ranked[] = []
  for (const [id, rows] of byCard) {
    let head: Level | undefined
    for (const source of SOURCE_ORDER) {
      const mine = rows.filter((r) => r.source === source)
      const variant = headlineVariant(mine.map((r) => r.variant as Variant))
      head = variant ? mine.find((r) => r.variant === variant) : undefined
      if (head) break
    }
    if (!head) continue
    const fx = rateOn(rates.get(head.currency) ?? [], today)
    const krw = fx ? toKrw(head.market, fx.krwPerUnit).krw : null
    if (krw === null) continue
    ranked.push({ id, krw, amount: head.market, currency: head.currency, source: head.source, variant: head.variant, date: head.lastSeenOn })
  }
  return ranked.sort((a, b) => b.krw - a.krw || a.id.localeCompare(b.id)).slice(0, limit)
}

function json(body: unknown, status: number, cache: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  })
}
const OK_CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=21600'
const fail = (status: number, message: string) => json({ error: { message, code: status } }, status, 'no-store')

const MEMO_MS = 10 * 60 * 1000
const memory = new Map<string, { body: unknown; expires: number }>()

/** `edition` and `set` are the only parameters; anything else is refused (like /prices: Security) */
export async function handleTop(params: URLSearchParams, now = new Date()) {
  // One URL per answer: a repeated or empty parameter would make endless cache misses (Security T-1)
  const keys = [...params.keys()]
  if (keys.some((key) => key !== 'edition' && key !== 'set') || keys.length !== new Set(keys).size) return fail(400, 'Bad request')
  if ([...params.values()].some((value) => value === '')) return fail(400, 'Bad request')
  const edition = params.get('edition') ?? 'en'
  const set = params.get('set') ?? ''
  if (edition !== 'en' && edition !== 'ja' && edition !== 'psa10') return fail(400, 'Bad request')
  if (set && !SET_ID.test(set)) return fail(400, 'Bad request')

  // Also in this instance's memory for 10 minutes, so edge misses don't each read the database
  const memoKey = `${edition}|${set}|${utcDay(now)}`
  const memo = memory.get(memoKey)
  if (memo && memo.expires > now.getTime()) return json(memo.body, 200, OK_CACHE)

  try {
    const { cards } = await loadPriceData()
    if (set && ![...cards.values()].some((c) => c.set === set)) return fail(404, 'Not found')
    const today = utcDay(now)
    const fx = await getFxRates(addDays(today, -14))
    const rates = new Map<string, FxRow[]>()
    for (const r of fx) rates.set(r.currency, [...(rates.get(r.currency) ?? []), r as FxRow])
    const keep = (id: string) => {
      const card = cards.get(id)
      return !!card && !isBasicEnergy(card) && (!set || card.set === set)
    }
    const ranked =
      edition === 'psa10'
        ? rankPsa10(await getLatestPsa10(addDays(today, -PSA_MAX_AGE_DAYS)), rates.get('USD') ?? [], today, keep)
        : rank(await getLatestLevels(edition, addDays(today, -FRESH_DAYS)), rates, today, keep)
    const body = { edition, set: set || null, today, cards: ranked }
    if (memory.size > 400) memory.clear() // at most every set × 2 editions; this just bounds it
    memory.set(memoKey, { body, expires: now.getTime() + MEMO_MS })
    return json(body, 200, OK_CACHE)
  } catch {
    // Never the error itself: it can hold query or connection details
    return fail(500, 'Server error')
  }
}
