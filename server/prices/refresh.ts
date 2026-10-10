// Fetching and storing one card's prices: shared by the daily cron and refresh-on-view.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { utcDay } from './logic.js'
import { fetchCardPrices } from './sources.js'
import { getEditionLink, savePrices, setRefreshStatus } from './store.js'

const DATA_DIR = path.join(process.cwd(), 'data')

export interface CardInfo {
  id: string
  name: string
  nameKo?: string
  nameKoUnofficial?: boolean
  set: string
  supertype: string
  subtypes?: string[]
  legal?: string
}

interface PriceData {
  cards: Map<string, CardInfo>
  /** our card id → TCGdex card id (scripts/build-tcgdex-map.mjs) */
  tcgdex: Map<string, string>
}

let dataPromise: Promise<PriceData> | null = null
export function loadPriceData() {
  dataPromise ??= (async () => {
    const [index, map] = await Promise.all([
      readFile(path.join(DATA_DIR, 'index.json'), 'utf8').then((t) => JSON.parse(t) as CardInfo[]),
      readFile(path.join(DATA_DIR, 'tcgdex-map.json'), 'utf8').then((t) => JSON.parse(t) as Record<string, string>),
    ])
    return {
      cards: new Map(
        index.map((c) => [
          c.id,
          {
            id: c.id,
            name: c.name,
            nameKo: c.nameKo,
            nameKoUnofficial: c.nameKoUnofficial,
            set: c.set,
            supertype: c.supertype,
            subtypes: c.subtypes,
            legal: c.legal,
          },
        ]),
      ),
      tcgdex: new Map(Object.entries(map)),
    }
  })().catch((error: unknown) => {
    dataPromise = null
    throw error
  })
  return dataPromise
}

/** Basic Energy has no meaningful price: no section, no fetching (qa) */
export const isBasicEnergy = (card: CardInfo) => card.supertype === 'Energy' && !!card.subtypes?.includes('Basic')

// Japanese prices only for links qa checked or the matcher is sure about
export const JA_MIN_CONFIDENCE = 0.9

/**
 * Fetches and stores a card's English (and linked Japanese) prices. The caller has already
 * claimed the refresh. Returns the refresh status and how many price levels changed.
 */
export async function refreshCard(cardId: string, now: Date, signal?: AbortSignal) {
  try {
    return await refreshCardOnce(cardId, now, signal)
  } catch (error) {
    // A database error part way: say so, so the claim doesn't stay "pending" (Security, 10/10)
    await setRefreshStatus(cardId, 'error').catch(() => {})
    throw error
  }
}

async function refreshCardOnce(cardId: string, now: Date, signal?: AbortSignal) {
  const { tcgdex } = await loadPriceData()
  const today = utcDay(now)
  const theirId = tcgdex.get(cardId)
  if (!theirId) {
    await setRefreshStatus(cardId, 'not_found')
    return { status: 'not_found' as const, changed: 0 }
  }

  const en = await fetchCardPrices('en', theirId, signal)
  if (en.status === 'rate_limited') {
    // Nothing stored; marked as an error so it's tried again (the collector slows down and may stop)
    await setRefreshStatus(cardId, 'error')
    return { status: 'rate_limited' as const, changed: 0, retryAfter: en.retryAfter }
  }
  let changed = 0
  if (en.status === 'ok') changed += await savePrices(cardId, 'en', en.rows, today)

  const link = await getEditionLink(cardId)
  if (link && link.method !== 'none' && link.externalId && (link.verified || link.confidence >= JA_MIN_CONFIDENCE)) {
    const ja = await fetchCardPrices('ja', link.externalId, signal)
    if (ja.status === 'ok') changed += await savePrices(cardId, 'ja', ja.rows, today)
  }

  const status = en.status === 'ok' ? (en.rows.length ? 'ok' : 'not_found') : en.status
  await setRefreshStatus(cardId, status)
  return { status, changed, ...(en.status === 'error' && { reason: `source ${en.reason ?? 'error'}` }) }
}
