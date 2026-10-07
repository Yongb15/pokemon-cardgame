import type { CardSearchParams } from '../api/cards'
import { POKEMON_TYPES, type PokemonType } from './pokemonTypes'

export const SORT_OPTIONS = {
  newest: { label: '최신 세트순' },
  oldest: { label: '오래된 세트순' },
  name: { label: '이름순' },
  number: { label: '번호순' },
} as const

export type SortKey = keyof typeof SORT_OPTIONS

export interface CardFilters {
  name: string
  type: PokemonType | ''
  set: string
  rarity: string
  sort: SortKey
}

export const DEFAULT_FILTERS: CardFilters = { name: '', type: '', set: '', rarity: '', sort: 'newest' }

export const PAGE_SIZE = 24

/** Longest search term the API accepts (longer is a 400) */
export const MAX_NAME_LENGTH = 50

function isSortKey(value: string): value is SortKey {
  return value in SORT_OPTIONS
}

/** Collapse runs of whitespace and trim: what the URL stores and what the search box is compared with */
export function cleanName(raw: string) {
  return raw.replace(/\s+/g, ' ').trim()
}

export function filtersFromParams(params: URLSearchParams): CardFilters {
  const rawType = (params.get('type') ?? '').toLowerCase()
  const type = POKEMON_TYPES.find((t) => t.toLowerCase() === rawType) ?? ''
  const sort = params.get('sort') ?? ''
  return {
    // A shared link may carry a longer term than the search box allows: trim it rather than fail
    name: cleanName(params.get('q') ?? '').slice(0, MAX_NAME_LENGTH),
    type,
    set: params.get('set') ?? '',
    rarity: params.get('rarity') ?? '',
    sort: isSortKey(sort) ? sort : DEFAULT_FILTERS.sort,
  }
}

export function pageFromParams(params: URLSearchParams) {
  const page = Number(params.get('page'))
  return Number.isInteger(page) && page > 1 ? page : 1
}

export function filtersToParams(filters: CardFilters, page = 1) {
  const params = new URLSearchParams()
  const name = cleanName(filters.name)
  if (name) params.set('q', name)
  if (filters.type) params.set('type', filters.type)
  if (filters.set) params.set('set', filters.set)
  if (filters.rarity) params.set('rarity', filters.rarity)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  return params
}

/** The API parameters for a search (page and page size are added by the caller) */
export function toSearchParams(filters: CardFilters): CardSearchParams {
  return {
    name: cleanName(filters.name) || undefined,
    type: filters.type || undefined,
    set: filters.set || undefined,
    rarity: filters.rarity || undefined,
    sort: filters.sort,
  }
}

export function activeFilterCount(filters: CardFilters) {
  return [cleanName(filters.name), filters.type, filters.set, filters.rarity].filter(Boolean).length
}
