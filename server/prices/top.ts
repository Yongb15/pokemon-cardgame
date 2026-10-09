// GET /api/prices/top?edition=en|ja&set=<set id> — the priciest cards right now (docs/design/price-ranking.webp).
//
// Ranks what has been collected: every card's latest unflagged level confirmed within the last
// week, its headline price chosen as on the detail page (TCGplayer first, then normal → holo → …),
// in won at today's rate. Cards nobody has fetched yet aren't in it; the page says so. Read-only:
// no refreshes, no outside calls. Cached at the edge for an hour.

import { addDays, headlineVariant, rateOn, toKrw, utcDay, type FxRow, type Variant } from './logic.js'
import { isBasicEnergy, loadPriceData } from './refresh.js'
import { getFxRates, getLatestLevels } from './store.js'

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

/** `edition` and `set` are the only parameters; anything else is refused (like /prices: Security) */
export async function handleTop(params: URLSearchParams, now = new Date()) {
  for (const key of params.keys()) if (key !== 'edition' && key !== 'set') return fail(400, 'Bad request')
  const edition = params.get('edition') ?? 'en'
  const set = params.get('set') ?? ''
  if (edition !== 'en' && edition !== 'ja') return fail(400, 'Bad request')
  if (set && !SET_ID.test(set)) return fail(400, 'Bad request')

  try {
    const { cards } = await loadPriceData()
    if (set && ![...cards.values()].some((c) => c.set === set)) return fail(404, 'Not found')
    const today = utcDay(now)
    const [levels, fx] = await Promise.all([getLatestLevels(edition, addDays(today, -FRESH_DAYS)), getFxRates(addDays(today, -14))])
    const rates = new Map<string, FxRow[]>()
    for (const r of fx) rates.set(r.currency, [...(rates.get(r.currency) ?? []), r as FxRow])
    const keep = (id: string) => {
      const card = cards.get(id)
      return !!card && !isBasicEnergy(card) && (!set || card.set === set)
    }
    return json({ edition, set: set || null, today, cards: rank(levels, rates, today, keep) }, 200, OK_CACHE)
  } catch {
    // Never the error itself: it can hold query or connection details
    return fail(500, 'Server error')
  }
}
