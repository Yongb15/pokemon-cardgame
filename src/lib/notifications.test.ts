import { describe, expect, it } from 'vitest'
import { ago } from './notifications'

describe('ago', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  it('says how long ago in Korean', () => {
    expect(ago(at(0.5), now)).toBe('방금')
    expect(ago(at(12), now)).toBe('12분 전')
    expect(ago(at(180), now)).toBe('3시간 전')
    expect(ago(at(30 * 60), now)).toBe('어제')
    expect(ago(at(5 * 24 * 60), now)).toMatch(/10월 5일/)
  })
})
