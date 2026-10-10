// Outside price and FX sources: TCGdex (card prices) and Frankfurter (ECB rates). Hosts are fixed
// constants, ids go into paths encoded, redirects are refused, responses are size-capped and every
// value is validated before it reaches the database (Security review).
//
// With PRICE_FIXTURES=1 outside production, answers come from recorded JSON in fixtures/ instead
// (qa: reproducible outliers, failures and timeouts). It can't be turned on by a request.

import { cleanPrice, type Currency, type Source, type Variant } from './logic.js'

const TCGDEX = 'https://api.tcgdex.net'
const FRANKFURTER = 'https://api.frankfurter.dev'
const MAX_BYTES = 1_000_000
const TIMEOUT_MS = 8_000

export interface PriceRow {
  source: Source
  variant: Variant
  currency: Currency
  market: number
  low: number | null
  avg30: number | null
}

export type FetchResult =
  | { status: 'ok'; rows: PriceRow[] }
  | { status: 'not_found' }
  /** Why, for the collector's tally: "HTTP 403", "not JSON", "TimeoutError"… (never a URL or body) */
  | { status: 'error'; reason?: string }
  /** 429 or 503: the source asks us to slow down (seconds to wait, when it says) */
  | { status: 'rate_limited'; retryAfter: number | null }

export const fixturesOn = () => process.env.PRICE_FIXTURES === '1' && process.env.VERCEL_ENV !== 'production'

class SourceError extends Error {}

/** The source said "slow down" (429/503) */
class RateLimited extends SourceError {
  readonly retryAfter: number | null

  constructor(retryAfter: number | null) {
    super('rate limited')
    this.retryAfter = retryAfter
  }
}

/**
 * A thrown network error as a safe label: its class and the cause's constant code, e.g.
 * "TypeError UND_ERR_CONNECT_TIMEOUT" (fetch failures are all "TypeError: fetch failed"). Never the
 * message or the cause's message, which can hold a host name (Security)
 */
export function networkLabel(error: unknown) {
  if (!(error instanceof Error)) return 'unknown'
  const code = (error.cause as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && /^[A-Z0-9_]{3,40}$/.test(code) ? `${error.name} ${code}` : error.name
}

/** Who is asking, and where to reach us (docs/price/collect-all.md D-3) */
export const USER_AGENT = 'card-dex-collector (+https://github.com/Yongb15/pokemon-cardgame)'

/** GET JSON from a fixed host: no redirects, JSON only, at most 1 MB, with a timeout */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (res.status === 404) return null
  if (res.status === 429 || res.status === 503) {
    const wait = Number(res.headers.get('retry-after'))
    throw new RateLimited(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 600) : null)
  }
  if (!res.ok) throw new SourceError(`HTTP ${res.status}`)
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new SourceError('not JSON')
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new SourceError('too large')
  const text = await readCapped(res, MAX_BYTES)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SourceError('bad JSON')
  }
}

/** Reads a body while counting bytes, stopping at `max` (a chunked reply has no length up front: Security P-3) */
export async function readCapped(res: Response, max: number) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new SourceError('too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// TCGplayer price keys → our variants (qa N-2). Anything else is skipped, never stored. Where two
// keys meet in one variant (1st Edition holo / normal), the first listed wins.
export const TCGPLAYER_VARIANTS: [key: string, variant: Variant][] = [
  ['normal', 'normal'],
  ['holofoil', 'holo'],
  ['reverseHolofoil', 'reverse'],
  ['reverse-holofoil', 'reverse'],
  ['unlimitedHolofoil', 'unlimited'],
  ['unlimited', 'unlimited'],
  ['unlimitedNormal', 'unlimited'],
  ['1stEditionHolofoil', 'firstEdition'],
  ['1stEdition', 'firstEdition'],
  ['1stEditionNormal', 'firstEdition'],
]

/**
 * The prices in a TCGdex card. TCGplayer: market price (else mid) per variant, in USD. Cardmarket:
 * one price set for the card and a "-holo" set; on a card that has a normal print, "-holo" is the
 * reverse holo, otherwise the base set is the holo card's price. Its trend price is the headline.
 */
export function parseTcgdexCard(card: unknown): PriceRow[] {
  if (!isObject(card) || !isObject(card.pricing)) return []
  const rows: PriceRow[] = []
  const variants = isObject(card.variants) ? card.variants : {}
  const hasNormal = variants.normal === true

  const tcgplayer = card.pricing.tcgplayer
  if (isObject(tcgplayer) && tcgplayer.unit === 'USD') {
    const seen = new Set<Variant>()
    for (const [key, variant] of TCGPLAYER_VARIANTS) {
      const p = tcgplayer[key]
      if (seen.has(variant) || !isObject(p)) continue
      const market = cleanPrice(p.marketPrice) ?? cleanPrice(p.midPrice)
      if (market === null) continue
      seen.add(variant)
      rows.push({ source: 'tcgplayer', variant, currency: 'USD', market, low: cleanPrice(p.lowPrice), avg30: null })
    }
  }

  const cm = card.pricing.cardmarket
  if (isObject(cm) && cm.unit === 'EUR') {
    const base = cleanPrice(cm.trend) ?? cleanPrice(cm.avg)
    if (base !== null) {
      rows.push({
        source: 'cardmarket',
        variant: hasNormal ? 'normal' : 'holo',
        currency: 'EUR',
        market: base,
        low: cleanPrice(cm.low),
        avg30: cleanPrice(cm.avg30),
      })
    }
    const holo = cleanPrice(cm['trend-holo']) ?? cleanPrice(cm['avg-holo'])
    if (holo !== null && hasNormal) {
      rows.push({
        source: 'cardmarket',
        variant: 'reverse',
        currency: 'EUR',
        market: holo,
        low: cleanPrice(cm['low-holo']),
        avg30: cleanPrice(cm['avg30-holo']),
      })
    }
  }
  return rows
}

/** A TCGdex card id as used in paths: letters, digits and . - _ only */
const TCGDEX_ID = /^[\w.-]{1,40}$/

export async function fetchCardPrices(lang: 'en' | 'ja', tcgdexId: string, signal?: AbortSignal): Promise<FetchResult> {
  if (!TCGDEX_ID.test(tcgdexId)) return { status: 'not_found' }
  try {
    const card = fixturesOn()
      ? await readFixture(`tcgdex-${lang}-${tcgdexId}`, signal)
      : await getJson(`${TCGDEX}/v2/${lang}/cards/${encodeURIComponent(tcgdexId)}`, signal)
    if (card === null) return { status: 'not_found' }
    return { status: 'ok', rows: parseTcgdexCard(card) }
  } catch (error) {
    if (error instanceof RateLimited) return { status: 'rate_limited', retryAfter: error.retryAfter }
    return { status: 'error', reason: error instanceof SourceError ? error.message : networkLabel(error) }
  }
}

export interface FxResult {
  rateDate: string
  rates: Partial<Record<Currency, number>>
}

/** KRW per USD, EUR and JPY on the latest ECB day */
export async function fetchFx(now: Date, signal?: AbortSignal): Promise<FxResult | null> {
  try {
    const body = fixturesOn()
      ? await readFixture('frankfurter', signal)
      : await getJson(`${FRANKFURTER}/v1/latest?base=EUR&symbols=KRW,USD,JPY`, signal)
    return parseFx(body, now)
  } catch {
    return null
  }
}

/** A real "YYYY-MM-DD" from 10 days ago to tomorrow (ECB days lag; "9999-99-99" isn't one: Security P-2) */
function isRecentDay(day: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const t = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) return false
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return t >= today - 10 * 86_400_000 && t <= today + 86_400_000
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Frankfurter answers per 1 EUR ("KRW": 1496.25, "USD": 1.1177). Asking with base KRW would give
 * five-digit rounded tiny numbers (USD 0.00075 → ₩1,333, 0.4% off), so we cross through EUR:
 * KRW per USD = KRW per EUR ÷ USD per EUR.
 */
export function parseFx(body: unknown, now: Date): FxResult | null {
  if (!isObject(body) || body.base !== 'EUR' || !isObject(body.rates)) return null
  if (typeof body.date !== 'string' || !isRecentDay(body.date, now)) return null
  const krwPerEur = body.rates.KRW
  if (!positive(krwPerEur)) return null
  const rates: FxResult['rates'] = { EUR: krwPerEur }
  for (const currency of ['USD', 'JPY'] as const) {
    const perEur = body.rates[currency]
    if (positive(perEur)) rates[currency] = krwPerEur / perEur
  }
  // Sanity range for KRW per unit (JPY ≈ 8.5, USD/EUR ≈ 1,300–1,600)
  for (const [currency, krw] of Object.entries(rates) as [Currency, number][]) {
    if (!(krw >= 1 && krw <= 10_000)) delete rates[currency]
  }
  return Object.keys(rates).length ? { rateDate: body.date, rates } : null
}

// --- Fixtures (dev/preview only) -----------------------------------------------------------------

async function readFixture(name: string, signal?: AbortSignal): Promise<unknown | null> {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const file = path.join(process.cwd(), 'server/prices/fixtures', `${name.replace(/[^\w.-]/g, '_')}.json`)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null // no fixture: the card is "not found"
  }
  const body = JSON.parse(text) as unknown
  // Special fixtures: { "fixture": "error" } fails, { "fixture": "timeout" } waits past the timeout
  if (isObject(body) && body.fixture === 'error') throw new SourceError('fixture error')
  if (isObject(body) && body.fixture === 'timeout') {
    // Like a real hung request: ends at the caller's abort or our own timeout (qa P2-2)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TIMEOUT_MS)
      signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
    })
    throw new SourceError('fixture timeout')
  }
  return body
}
