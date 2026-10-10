import { describe, expect, it } from 'vitest'
import { deckStats } from './deckStats'
import type { CardListItem } from '../types/card'

const card = (id: string, supertype: string, subtypes: string[], extra: Partial<CardListItem> = {}) =>
  ({ id, name: id, supertype, subtypes, number: '1', set: {}, images: {}, ...extra }) as unknown as CardListItem

const info = new Map(
  [
    card('charmander', 'Pokémon', ['Basic'], { types: ['Fire'] }),
    card('charmeleon', 'Pokémon', ['Stage 1'], { types: ['Fire'] }),
    card('charizard-ex', 'Pokémon', ['Stage 2', 'ex', 'Tera'], { types: ['Darkness'] }),
    card('pidgeot-vmax', 'Pokémon', ['VMAX'], { types: ['Colorless'] }),
    card('arven', 'Trainer', ['Supporter']),
    card('candy', 'Trainer', ['Item']),
    card('tm', 'Trainer', ['Item', 'Technical Machine']),
    card('belt', 'Trainer', ['Pokémon Tool']),
    card('tool-f', 'Trainer', ['Pokémon Tool F']),
    card('artazon', 'Trainer', ['Stadium']),
    card('old-trainer', 'Trainer', []),
    card('fire', 'Energy', ['Basic'], { nameKo: '기본 불꽃 에너지' }),
    card('fire-2', 'Energy', ['Basic'], { nameKo: '기본 불꽃 에너지' }),
    card('dark', 'Energy', ['Basic'], { nameKo: '기본 악 에너지' }),
    card('jet', 'Energy', ['Special']),
  ].map((c) => [c.id, c]),
)

describe('deck composition', () => {
  it('counts kinds, stages, rule boxes, types, trainer kinds and energy', () => {
    const s = deckStats(
      [
        { id: 'charmander', count: 4 },
        { id: 'charmeleon', count: 2 },
        { id: 'charizard-ex', count: 3 },
        { id: 'pidgeot-vmax', count: 1 },
        { id: 'arven', count: 4 },
        { id: 'candy', count: 4 },
        { id: 'tm', count: 1 },
        { id: 'belt', count: 2 },
        { id: 'tool-f', count: 1 },
        { id: 'artazon', count: 1 },
        { id: 'old-trainer', count: 1 },
        { id: 'fire', count: 10 },
        { id: 'fire-2', count: 4 },
        { id: 'dark', count: 2 },
        { id: 'jet', count: 2 },
      ],
      info,
    )
    expect([s.pokemon, s.trainer, s.energy]).toEqual([10, 14, 18])
    expect(s.stages).toEqual({ Basic: 4, 'Stage 1': 2, 'Stage 2': 3, Other: 1 })
    expect(s.ruleBox).toBe(4) // ex and VMAX
    expect(s.types).toEqual([
      { type: 'Fire', count: 6 },
      { type: 'Darkness', count: 3 },
      { type: 'Colorless', count: 1 },
    ])
    expect(s.trainers).toEqual({ Supporter: 4, Item: 5, 'Pokémon Tool': 3, Stadium: 1, Other: 1 })
    // Two prints of the same Basic Energy are one line
    expect(s.basicEnergy).toEqual([
      { name: '기본 불꽃 에너지', count: 14 },
      { name: '기본 악 에너지', count: 2 },
    ])
    expect(s.specialEnergy).toBe(2)
  })

  it('leaves out cards whose details have not loaded', () => {
    const s = deckStats([{ id: 'charmander', count: 4 }, { id: 'unknown', count: 3 }], info)
    expect(s.pokemon).toBe(4)
    expect(s.trainer + s.energy).toBe(0)
  })
})
