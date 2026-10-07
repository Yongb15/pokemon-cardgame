// Card shape served by /api/cards (server/cardsApi.ts): the Pokémon TCG API v2 card object
// (https://docs.pokemontcg.io/api-reference/cards/card-object) plus `nameKo`.

export interface CardImages {
  /** Self-hosted WebP (scripts/build-images.mjs) */
  small: string
  large: string
  /** Original Pokémon TCG image URLs, used if a hosted copy fails to load */
  fallbackSmall?: string
  fallbackLarge?: string
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
    fallbackSymbol?: string
    fallbackLogo?: string
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
  /** Official Korean name where one exists (Pokémon via PokéAPI, basic Energy) */
  nameKo?: string
  supertype: string
  subtypes?: string[]
  hp?: string
  types?: string[]
  evolvesFrom?: string
  evolvesFromKo?: string
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
}

/** What the list and related-cards sections get: a subset of the card, no large image */
export type CardListItem = Pick<
  Card,
  'id' | 'name' | 'nameKo' | 'supertype' | 'subtypes' | 'hp' | 'types' | 'number' | 'rarity' | 'set'
> & {
  images: Pick<CardImages, 'small' | 'fallbackSmall'>
  /** Formats besides Unlimited the card is legal in ("standard", "expanded") */
  formats?: string[]
}

/** Previous/next card in a set */
export type CardSummary = Pick<Card, 'id' | 'name' | 'nameKo' | 'number'> & {
  images: Pick<CardImages, 'small' | 'fallbackSmall'>
}

export interface PagedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  count: number
  totalCount: number
}
