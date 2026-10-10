// What a deck is made of (docs/design/deck-add-and-stats.webp ⑤): counted from the deck's cards on
// the spot, nothing stored. Cards whose details haven't loaded are left out.

import { SUBTYPE_LABEL } from './cardText'
import { isPokemonType, type PokemonType } from './pokemonTypes'
import type { DeckCard } from './deck'
import type { CardListItem } from '../types/card'

/** Subtypes that put a rule box on a Pokémon (ex, V, Radiant…): the ones an opponent takes extra prizes for, mostly */
const RULE_BOX = new Set(['ex', 'EX', 'GX', 'TAG TEAM', 'V', 'VMAX', 'VSTAR', 'V-UNION', 'Radiant', 'Prism Star', 'LEGEND', 'MEGA', 'BREAK', 'Star'])

export const STAGES = ['Basic', 'Stage 1', 'Stage 2', 'Other'] as const
export type Stage = (typeof STAGES)[number]
export const STAGE_LABEL: Record<Stage, string> = { ...(SUBTYPE_LABEL as Record<Stage, string>), Other: '그 밖의 진화 (VMAX·VSTAR 등)' }

export const TRAINER_KINDS = ['Supporter', 'Item', 'Pokémon Tool', 'Stadium', 'Other'] as const
export type TrainerKind = (typeof TRAINER_KINDS)[number]
export const TRAINER_LABEL: Record<TrainerKind, string> = { ...(SUBTYPE_LABEL as Record<TrainerKind, string>), Other: '그 밖의 트레이너스' }

export interface DeckStats {
  pokemon: number
  trainer: number
  energy: number
  stages: Record<Stage, number>
  /** Pokémon with a rule box (a subset of `pokemon`) */
  ruleBox: number
  /** By each Pokémon's first type, largest first */
  types: { type: PokemonType; count: number }[]
  trainers: Record<TrainerKind, number>
  /** Basic Energy by card name, largest first */
  basicEnergy: { name: string; count: number }[]
  specialEnergy: number
}

const stageOf = (subtypes: string[]): Stage =>
  subtypes.includes('Basic') ? 'Basic' : subtypes.includes('Stage 1') ? 'Stage 1' : subtypes.includes('Stage 2') ? 'Stage 2' : 'Other'

const trainerKindOf = (subtypes: string[]): TrainerKind =>
  subtypes.includes('Supporter')
    ? 'Supporter'
    : subtypes.includes('Stadium')
      ? 'Stadium'
      : subtypes.some((s) => s.startsWith('Pokémon Tool'))
        ? 'Pokémon Tool'
        : subtypes.includes('Item')
          ? 'Item'
          : 'Other'

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

export function deckStats(cards: DeckCard[], info: Map<string, CardListItem>): DeckStats {
  const stats: DeckStats = {
    pokemon: 0,
    trainer: 0,
    energy: 0,
    stages: { Basic: 0, 'Stage 1': 0, 'Stage 2': 0, Other: 0 },
    ruleBox: 0,
    types: [],
    trainers: { Supporter: 0, Item: 0, 'Pokémon Tool': 0, Stadium: 0, Other: 0 },
    basicEnergy: [],
    specialEnergy: 0,
  }
  const types = new Map<PokemonType, number>()
  const energy = new Map<string, number>()
  for (const { id, count } of cards) {
    const card = info.get(id)
    if (!card) continue
    const subtypes = card.subtypes ?? []
    if (card.supertype === 'Pokémon') {
      stats.pokemon += count
      stats.stages[stageOf(subtypes)] += count
      if (subtypes.some((s) => RULE_BOX.has(s))) stats.ruleBox += count
      const type = card.types?.find(isPokemonType)
      if (type) types.set(type, (types.get(type) ?? 0) + count)
    } else if (card.supertype === 'Trainer') {
      stats.trainer += count
      stats.trainers[trainerKindOf(subtypes)] += count
    } else if (card.supertype === 'Energy') {
      stats.energy += count
      if (subtypes.includes('Basic')) {
        const name = card.nameKo ?? card.name
        energy.set(name, (energy.get(name) ?? 0) + count)
      } else stats.specialEnergy += count
    }
  }
  stats.types = [...types].map(([type, count]) => ({ type, count })).sort(byCount)
  stats.basicEnergy = [...energy].map(([name, count]) => ({ name, count })).sort(byCount)
  return stats
}
