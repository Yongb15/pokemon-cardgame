import { describe, expect, it } from 'vitest'
import { handleCards } from './cardsApi.js'

type Item = { id: string; name: string; matchedMove?: { name: string; nameKo?: string } }

async function search(query: string) {
  const res = await handleCards('', new URLSearchParams(query))
  return { status: res.status, body: (await res.json()) as { data: Item[]; totalCount: number } }
}

describe('card search by attack/Ability name (?in=move)', () => {
  it('finds cards by the Korean move name and says which move matched', async () => {
    const { status, body } = await search('name=화염방사&in=move&pageSize=50')
    expect(status).toBe(200)
    expect(body.totalCount).toBeGreaterThan(0)
    for (const card of body.data) expect(card.matchedMove?.nameKo).toContain('화염방사')
  })

  it('finds the same cards by the English move name, ignoring case and spacing', async () => {
    const ko = await search('name=화염방사&in=move&pageSize=250')
    const en = await search('name=flame thrower&in=move&pageSize=250')
    expect(en.body.data.every((c) => c.matchedMove?.name.toLowerCase().includes('flamethrower'))).toBe(true)
    // Every Flamethrower is 화염방사, so both searches find at least the English ones
    const koIds = new Set(ko.body.data.map((c) => c.id))
    expect(en.body.data.filter((c) => c.matchedMove?.name === 'Flamethrower').every((c) => koIds.has(c.id))).toBe(true)
  })

  it('does not match card names in move mode, nor moves in name mode', async () => {
    const byMove = await search('name=리자몽&in=move')
    const byName = await search('name=리자몽')
    expect(byName.body.totalCount).toBeGreaterThan(byMove.body.totalCount)
    expect(byName.body.data.every((c) => c.matchedMove === undefined)).toBe(true)
  })

  it('combines with the other filters', async () => {
    const all = await search('name=화염방사&in=move&pageSize=250')
    const fire = await search('name=화염방사&in=move&type=Fire&pageSize=250')
    expect(fire.body.totalCount).toBeGreaterThan(0)
    expect(fire.body.totalCount).toBeLessThanOrEqual(all.body.totalCount)
  })

  it('rejects an unknown scope, including prototype keys', async () => {
    for (const scope of ['text', 'constructor', '__proto__']) {
      expect((await search(`name=a&in=${scope}`)).status).toBe(400)
    }
  })

  it('without a search term, `in=move` lists every card as usual', async () => {
    const plain = await search('')
    const scoped = await search('in=move')
    expect(scoped.body.totalCount).toBe(plain.body.totalCount)
  })
})
