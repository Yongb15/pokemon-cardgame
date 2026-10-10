import { describe, expect, it } from 'vitest'
import { collect, dueOrder, isDueToday } from './collect.js'
import { isSameLevel } from './logic.js'
import type { CardInfo } from './refresh.js'

const card = (id: string, extra: Partial<CardInfo> = {}): CardInfo => ({ id, name: id, set: 'old1', supertype: 'Pokémon', ...extra })

describe('same price level (Security: against the stored level, not yesterday)', () => {
  it('treats under 1% (or under 0.02) as the same level', () => {
    expect(isSameLevel(100, 100.9)).toBe(true)
    expect(isSameLevel(100, 101)).toBe(false) // exactly 1% is a new level
    expect(isSameLevel(1, 1.019)).toBe(true) // 1.9%, but under 0.02
    expect(isSameLevel(1, 1.02)).toBe(false)
    expect(isSameLevel(0.5, 0.48)).toBe(false) // 0.02 down
  })

  it('a slow drift becomes a new level once it adds up past 1%', () => {
    let level = 100
    const levels: number[] = []
    for (const day of [1, 2, 3]) {
      const price = 100 * 1.009 ** day // +0.9% a day
      if (!isSameLevel(level, price)) level = price
      levels.push(level)
    }
    expect(levels[0]).toBe(100) // day 1: 0.9% — same
    expect(levels[1]).toBeGreaterThan(100) // day 2: 1.8% from the stored level — new
  })
})

describe('collector tiers', () => {
  const released = new Map([
    ['new1', '2026/06/01'],
    ['old1', '2001/01/01'],
  ])
  it('Standard and last-year sets every day, the rest once a week', () => {
    expect(isDueToday(card('x', { legal: 'se' }), released, '2026-10-09')).toBe(true)
    expect(isDueToday(card('y', { set: 'new1' }), released, '2026-10-09')).toBe(true)
    const old = card('base1-4')
    const days = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    expect(days.filter((d) => isDueToday(old, released, d))).toHaveLength(1)
  })

  it('orders never-refreshed first, then oldest, and leaves out recent ones', () => {
    const now = new Date('2026-10-09T19:30:00Z')
    const times = new Map([
      ['a', new Date('2026-10-08T19:40:00Z')], // 23.8 h ago: due
      ['b', new Date('2026-10-09T10:00:00Z')], // 9.5 h ago: not yet
      ['c', new Date('2026-10-01T00:00:00Z')],
    ])
    expect(dueOrder(['a', 'b', 'c', 'd'], times, now)).toEqual(['d', 'c', 'a'])
  })
})

describe('polite collection', () => {
  it('waits on a rate limit, retries the card, and stops after three in a row', async () => {
    const waits: number[] = []
    const replies = [{ status: 'rate_limited', changed: 0, retryAfter: 30 }, { status: 'ok', changed: 1 }]
    const seen: string[] = []
    const counts = await collect(
      ['a', 'b'],
      async (id) => {
        seen.push(id)
        return replies.shift() ?? { status: 'ok', changed: 0 }
      },
      { concurrency: 1, pauseMs: 0, sleep: async (ms) => void waits.push(ms) },
    )
    expect(seen).toEqual(['a', 'a', 'b'])
    expect(waits).toContain(30_000)
    expect(counts).toMatchObject({ processed: 2, rateLimited: 1, changed: 1, stopped: null })

    const stopped = await collect(['x', 'y'], async () => ({ status: 'rate_limited', changed: 0, retryAfter: null }), {
      concurrency: 1,
      pauseMs: 0,
      sleep: async () => {},
    })
    expect(stopped).toMatchObject({ rateLimited: 3, stopped: 'rate-limited', left: 2 })
  })

  it('stops after 50 failures in a row, and at the deadline', async () => {
    const failing = await collect(Array.from({ length: 80 }, (_, i) => `c${i}`), async () => ({ status: 'error', changed: 0 }), {
      concurrency: 1,
      pauseMs: 0,
      sleep: async () => {},
    })
    expect(failing).toMatchObject({ failed: 50, stopped: 'failures', left: 30 })

    let t = 0
    const late = await collect(['a', 'b', 'c'], async () => ({ status: 'ok', changed: 0 }), {
      concurrency: 1,
      pauseMs: 0,
      sleep: async () => {},
      deadline: 2,
      now: () => t++,
    })
    expect(late.stopped).toBe('deadline')
  })
})

describe('failure labels (safe constants only)', () => {
  it('names database errors by code, or by the driver error and its cause code', async () => {
    const { errorLabel } = await import('./collect.js')
    const { DbError } = await import('./store.js')
    const coded = Object.assign(new DbError('database error'), { code: '57014' })
    expect(errorLabel(coded)).toBe('DbError 57014')
    const network = Object.assign(new DbError('database error'), { inner: 'NeonDbError UND_ERR_SOCKET' })
    expect(errorLabel(network)).toBe('DbError (NeonDbError UND_ERR_SOCKET)')
    expect(errorLabel(new DbError('database error'))).toBe('DbError')
    // A message never appears, even one with a host in it
    expect(errorLabel(new Error('connect to db.example.neon.tech failed'))).toBe('Error')
  })

  it("labels the driver's errors by fetch cause or HTTP status, never by message", async () => {
    const { driverLabel } = await import('./store.js')
    class NeonDbError extends Error {
      override name = 'NeonDbError'
      sourceError?: unknown
    }
    const fetchFailed = new TypeError('fetch failed', { cause: Object.assign(new Error('ep-x.neon.tech'), { code: 'UND_ERR_SOCKET' }) })
    const connect = Object.assign(new NeonDbError(`Error connecting to database: ${fetchFailed}`), { sourceError: fetchFailed })
    expect(driverLabel(connect)).toBe('NeonDbError fetch TypeError UND_ERR_SOCKET')
    const http = new NeonDbError('Server error (HTTP status 503): secret body ep-x.neon.tech')
    expect(driverLabel(http)).toBe('NeonDbError HTTP 503')
    // Drizzle's wrapper is looked through
    expect(driverLabel(new Error('Failed query: select …', { cause: http }))).toBe('NeonDbError HTTP 503')
    expect(driverLabel(new NeonDbError('something with ep-x.neon.tech'))).toBe('NeonDbError')
    expect(driverLabel('nope')).toBeNull()
  })
})
