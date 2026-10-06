// Pokémon TCG API v2 card shape (only the fields this app uses)
// https://docs.pokemontcg.io/api-reference/cards/card-object

export interface CardImages {
  small: string
  large: string
}

export interface CardSetSummary {
  id: string
  name: string
  series: string
  releaseDate: string
  images: {
    symbol: string
    logo: string
  }
}

export interface Attack {
  name: string
  cost: string[]
  convertedEnergyCost: number
  damage: string
  text: string
}

export interface TypeModifier {
  type: string
  value: string
}

export interface Card {
  id: string
  name: string
  supertype: string
  subtypes?: string[]
  hp?: string
  types?: string[]
  evolvesFrom?: string
  attacks?: Attack[]
  weaknesses?: TypeModifier[]
  resistances?: TypeModifier[]
  retreatCost?: string[]
  rules?: string[]
  number: string
  artist?: string
  rarity?: string
  flavorText?: string
  set: CardSetSummary
  images: CardImages
}

export interface PagedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  count: number
  totalCount: number
}
