// Made-up values only (Security P-2)
import { describe, expect, it } from 'vitest'
import { psaView } from './psaView.js'
import type { PsaRow } from './store.js'

const row = (grade: string, capturedOn: string, median: number, sales = 5): PsaRow => ({ grade, capturedOn, median, sales, lastSaleOn: '2026-01-01' })
const usd = [{ currency: 'USD', rateDate: '2026-02-01', krwPerUnit: 1000, usable: true }]

describe('PSA view', () => {
  it('shows the latest collection by grade, in won, with each grade over time', () => {
    const v = psaView([row('psa9', '2026-02-01', 20), row('psa10', '2026-02-01', 50), row('psa10', '2026-02-08', 60, 9), row('psa8', '2026-02-08', 10.5)], 80, usd, '2026-02-10')
    expect(v).toEqual({
      state: 'ok',
      capturedOn: '2026-02-08',
      grades: [
        { grade: 'psa10', usd: 60, krw: 60000, sales: 9, lastSaleOn: '2026-01-01' },
        { grade: 'psa8', usd: 10.5, krw: 10500, sales: 5, lastSaleOn: '2026-01-01' },
      ],
      history: [
        { grade: 'psa10', points: [{ date: '2026-02-01', usd: 50 }, { date: '2026-02-08', usd: 60 }] },
        { grade: 'psa9', points: [{ date: '2026-02-01', usd: 20 }] },
        { grade: 'psa8', points: [{ date: '2026-02-08', usd: 10.5 }] },
      ],
    })
  })

  it('hides values older than 30 days', () => {
    expect(psaView([row('psa10', '2026-01-01', 50)], 80, usd, '2026-02-10')).toEqual({ state: 'pending' })
    expect(psaView([row('psa10', '2026-01-01', 50)], 10, usd, '2026-02-10')).toEqual({ state: 'untracked', minUsd: 50 })
  })

  it('waits for collection when priced high enough, else says the card is not collected', () => {
    expect(psaView([], 80, usd, '2026-02-10')).toEqual({ state: 'pending' })
    expect(psaView([], null, usd, '2026-02-10')).toEqual({ state: 'untracked', minUsd: 50 })
  })

  it('keeps dollars when there is no rate', () => {
    const v = psaView([row('psa10', '2026-02-08', 60)], 80, [], '2026-02-10')
    expect(v.state === 'ok' && v.grades[0]!.krw).toBeNull()
  })
})
