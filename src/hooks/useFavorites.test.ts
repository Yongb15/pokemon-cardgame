import { beforeEach, describe, expect, it, vi } from 'vitest'

// The account API with a fake server: each call resolves when the test says so
const server = { has: new Set<string>(), calls: [] as string[] }
const gates: (() => void)[] = []
const gate = () => new Promise<void>((resolve) => gates.push(resolve))
const release = async () => {
  while (gates.length) {
    gates.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }
}

vi.mock('../api/account', () => ({
  AccountApiError: class extends Error {},
  setSignedOutHandler: () => {},
  getMe: async () => ({ user: null }),
  logout: async () => {},
  getFavorites: async () => ({ cards: [...server.has] }),
  addFavorite: async (id: string) => {
    server.calls.push(`+${id}`)
    await gate()
    server.has.add(id)
  },
  removeFavorite: async (id: string) => {
    server.calls.push(`-${id}`)
    await gate()
    server.has.delete(id)
  },
}))

const { loadFavorites, toggleFavorite } = await import('./useFavorites')

describe('hearts (qa H-1)', () => {
  beforeEach(async () => {
    server.has = new Set(['a'])
    server.calls = []
    await loadFavorites()
  })

  it('quick repeated presses end where the last press left them, one request at a time', async () => {
    // Four presses on card b (on, off, on, off) before any request finishes
    const first = toggleFavorite('b')
    void toggleFavorite('b')
    void toggleFavorite('b')
    void toggleFavorite('b')
    await release()
    expect(await first).toBeNull()
    // One request at a time: the add, then one remove for the final wish
    expect(server.calls).toEqual(['+b', '-b'])
    expect(server.has.has('b')).toBe(false)
  })

  it('an even number of presses sends nothing more once the server already matches', async () => {
    const first = toggleFavorite('a') // remove
    void toggleFavorite('a') // add back while the remove is running
    await release()
    await first
    expect(server.calls).toEqual(['-a', '+a'])
    expect(server.has.has('a')).toBe(true)
  })
})
