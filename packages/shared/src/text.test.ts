import { describe, expect, it } from 'vitest'
import { cleanText } from './text.js'

describe('cleanText (deck names, nicknames)', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  내\t\n 덱  ', 50)).toBe('내 덱')
  })
  it('drops control and bidi characters but keeps emoji joiners', () => {
    expect(cleanText('a‮b​c', 50)).toBe('abc')
    expect(cleanText('👩‍💻 덱', 50)).toBe('👩‍💻 덱')
  })
  it('cuts to the limit before trimming', () => {
    expect(cleanText(`${'a'.repeat(49)} b`, 50)).toBe('a'.repeat(49))
  })
  it('returns empty when nothing visible is left', () => {
    expect(cleanText('‍​  ', 50)).toBe('')
  })
})
