// The collector's PSA step (docs/price/psa.md): after the TCGdex prices, today's share of the priciest
// cards gets its PSA 10/9/8 prices from Pokemon Price Tracker, within the free plan's daily credits.

import { loadPriceData } from './refresh.js'
import { fetchPsa, fetchTcgplayerId } from './sources.js'
import { psaTargets, savePsa, setPsaStatus } from './store.js'

/** Cards at or above this TCGplayer price get PSA prices */
export const PSA_MIN_USD = 50
/** The priciest cards that take part: 45 a day × 7 days, so each is refreshed weekly */
export const PSA_POOL = 315
export const PSA_PER_DAY = 45
/** Stop with this many credits left (a card costs 2) */
const RESERVE_CREDITS = 10
const SPACING_MS = 1500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface PsaCounts {
  targets: number
  saved: number
  noSales: number
  skipped: number
  failed: number
  stopped: null | 'unauthorized' | 'rate-limited' | 'credits'
  reasons: Record<string, number>
}

export async function collectPsa(apiKey: string, today: string, limit = PSA_PER_DAY): Promise<PsaCounts> {
  const counts: PsaCounts = { targets: 0, saved: 0, noSales: 0, skipped: 0, failed: 0, stopped: null, reasons: {} }
  const note = (reason: string) => (counts.reasons[reason] = (counts.reasons[reason] ?? 0) + 1)
  const { tcgdex } = await loadPriceData()
  const targets = await psaTargets(today, PSA_MIN_USD, PSA_POOL, limit)
  counts.targets = targets.length

  for (const [i, cardId] of targets.entries()) {
    if (i) await sleep(SPACING_MS)
    const tcgdexId = tcgdex.get(cardId)
    const productId = tcgdexId ? await fetchTcgplayerId(tcgdexId) : null
    if (!tcgdexId || !productId) {
      // No TCGplayer product to ask about: try again next week, without spending credits
      counts.skipped++
      note('no product id')
      await setPsaStatus(cardId, 'not_found')
      continue
    }
    const result = await fetchPsa(productId, tcgdexId, apiKey, today)
    if (result.status === 'unauthorized' || result.status === 'rate_limited') {
      counts.stopped = result.status === 'unauthorized' ? 'unauthorized' : 'rate-limited'
      note(result.reason ?? result.status)
      break
    }
    if (result.status === 'ok') {
      if (result.grades.length) {
        await savePsa(cardId, today, result.grades)
        await setPsaStatus(cardId, 'ok')
        counts.saved++
      } else {
        await setPsaStatus(cardId, 'no_sales')
        counts.noSales++
      }
    } else if (result.status === 'not_found' || result.status === 'mismatch') {
      await setPsaStatus(cardId, 'not_found')
      counts.skipped++
      note(result.status)
    } else if (result.status === 'error') {
      await setPsaStatus(cardId, 'error')
      counts.failed++
      note(result.reason ?? 'error')
    }
    if (result.dailyRemaining !== null && result.dailyRemaining <= RESERVE_CREDITS) {
      counts.stopped = 'credits'
      break
    }
  }
  return counts
}
