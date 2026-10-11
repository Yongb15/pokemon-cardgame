// Card-pack labels shared by the packs and collection pages (docs/auction/packs.md)

import type { PackTier } from '../api/account'

export const TIER_LABEL: Record<PackTier, string> = {
  common: '커먼',
  uncommon: '언커먼',
  rare: '레어',
  double: '더블 레어',
  illustration: '일러스트 레어',
  ultra: '울트라 레어',
  sir: '스페셜 일러스트 레어',
  hyper: '하이퍼 레어',
}

/** A request id for one press of "열기": reused if that request has to be retried (qa: same key) */
export function newRequestId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}
