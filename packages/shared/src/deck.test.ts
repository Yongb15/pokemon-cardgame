import { describe, expect, it } from 'vitest'
import { cleanNickname, isDeckFormat, sanitizeCards, validCards } from './deck.js'

describe('deck rules', () => {
  it('sanitizes: merges duplicates, drops bad entries', () => {
    expect(
      sanitizeCards([
        { id: 'sv1-1', count: 2 },
        { id: 'sv1-1', count: 3 },
        { id: 'bad id', count: 1 },
        { id: 'sv1-2', count: 0 },
        { id: 'sv1-3', count: '4' },
        null,
      ]),
    ).toEqual([{ id: 'sv1-1', count: 5 }])
  })

  it('validates strictly: rejects duplicates, extra fields, bad counts and too many entries', () => {
    expect(validCards([{ id: 'sv1-1', count: 4 }])).toBe(true)
    expect(validCards([])).toBe(true)
    expect(validCards([{ id: 'sv1-1', count: 1 }, { id: 'sv1-1', count: 1 }])).toBe(false)
    expect(validCards([{ id: 'sv1-1', count: 1, x: 1 }])).toBe(false)
    expect(validCards([{ id: 'sv1-1', count: 61 }])).toBe(false)
    expect(validCards([{ id: 'sv1-1', count: 1.5 }])).toBe(false)
    expect(validCards([['sv1-1', 1]])).toBe(false)
    expect(validCards(Array.from({ length: 61 }, (_, i) => ({ id: `sv1-${i}`, count: 1 })))).toBe(false)
    expect(validCards({ id: 'sv1-1', count: 1 })).toBe(false)
  })

  it('knows the formats', () => {
    expect(isDeckFormat('expanded')).toBe(true)
    expect(isDeckFormat('constructor')).toBe(false)
  })

  it('cleans nicknames to 2–20 visible characters', () => {
    expect(cleanNickname('  피카‮츄  ')).toBe('피카츄')
    expect(cleanNickname('a')).toBeNull()
    expect(cleanNickname('​​')).toBeNull()
    expect(cleanNickname('가'.repeat(25))).toBe('가'.repeat(20))
  })
})
