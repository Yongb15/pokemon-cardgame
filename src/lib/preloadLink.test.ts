import { describe, expect, it } from 'vitest'
import config from '../../vercel.json'
import { DEFAULT_FILTERS, PAGE_SIZE, toSearchParams } from './cardFilters'

// vercel.json preloads the plain list's first request with the HTML of "/". The browser only
// reuses it if the app asks for exactly the same URL, so the two must never drift apart.
describe('the list preload in vercel.json', () => {
  const link = config.headers
    .find((h) => h.source === '/')
    ?.headers.find((h) => h.key === 'Link')?.value

  it('is the URL the list page requests first (api/cards.ts buildUrl order)', () => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...toSearchParams(DEFAULT_FILTERS), page: 1, pageSize: PAGE_SIZE })) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    expect(link).toBe(`</api/cards?${params}>; rel=preload; as=fetch; crossorigin`)
  })
})
