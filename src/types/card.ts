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
  printedTotal?: number
  total?: number
  images: {
    symbol: string
    logo: string
  }
}

/** Set as listed by `/sets` with `select=id,name,series,releaseDate` */
export type CardSet = Pick<CardSetSummary, 'id' | 'name' | 'series' | 'releaseDate'>

export interface Attack {
  name: string
  cost: string[]
  convertedEnergyCost: number
  damage: string
  text: string
}

export interface Ability {
  name: string
  text: string
  type: string
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
  abilities?: Ability[]
  attacks?: Attack[]
  weaknesses?: TypeModifier[]
  resistances?: TypeModifier[]
  retreatCost?: string[]
  rules?: string[]
  number: string
  artist?: string
  rarity?: string
  flavorText?: string
  nationalPokedexNumbers?: number[]
  regulationMark?: string
  legalities?: Partial<Record<'standard' | 'expanded' | 'unlimited', string>>
  set: CardSetSummary
  images: CardImages
  tcgplayer?: TcgplayerInfo
  cardmarket?: CardmarketInfo
}

export interface TcgplayerPrice {
  low?: number | null
  mid?: number | null
  high?: number | null
  market?: number | null
  directLow?: number | null
}

export interface TcgplayerInfo {
  url: string
  updatedAt: string
  /** Keyed by printing: normal, holofoil, reverseHolofoil, 1stEditionHolofoil, ... */
  prices?: Record<string, TcgplayerPrice>
}

export interface CardmarketInfo {
  url: string
  updatedAt: string
  prices?: {
    trendPrice?: number
    lowPrice?: number
    avg30?: number
  }
}

/** The fields the related/neighbor lists ask for with `select=` */
export type CardSummary = Pick<Card, 'id' | 'name' | 'number' | 'images'> & { set: Pick<CardSetSummary, 'id' | 'name'> }

export interface PagedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  count: number
  totalCount: number
}
