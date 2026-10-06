export const POKEMON_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Dragon',
  'Fairy',
  'Colorless',
] as const

export type PokemonType = (typeof POKEMON_TYPES)[number]

export const TYPE_LABEL: Record<PokemonType, string> = {
  Grass: '풀',
  Fire: '불꽃',
  Water: '물',
  Lightning: '번개',
  Psychic: '초',
  Fighting: '격투',
  Darkness: '악',
  Metal: '강철',
  Dragon: '드래곤',
  Fairy: '페어리',
  Colorless: '무색',
}

export const TYPE_COLOR: Record<PokemonType, string> = {
  Grass: '#4caf50',
  Fire: '#f05a28',
  Water: '#2f8fe0',
  Lightning: '#e0b000',
  Psychic: '#a855f7',
  Fighting: '#b45309',
  Darkness: '#374151',
  Metal: '#6b7280',
  Dragon: '#b08d2a',
  Fairy: '#ec4899',
  Colorless: '#a1a1aa',
}

/** Badge text color per type: whichever of ink/white clears WCAG AA (4.5:1) on TYPE_COLOR */
export const TYPE_TEXT: Record<PokemonType, string> = {
  Grass: '#09090b',
  Fire: '#09090b',
  Water: '#09090b',
  Lightning: '#09090b',
  Psychic: '#09090b',
  Fighting: '#fff',
  Darkness: '#fff',
  Metal: '#fff',
  Dragon: '#09090b',
  Fairy: '#09090b',
  Colorless: '#09090b',
}

export const SUPERTYPE_LABEL: Record<string, string> = {
  Pokémon: '포켓몬',
  Trainer: '트레이너',
  Energy: '에너지',
}

export function isPokemonType(value: string): value is PokemonType {
  return (POKEMON_TYPES as readonly string[]).includes(value)
}
