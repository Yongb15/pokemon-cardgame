import { isPokemonType, type PokemonType } from './pokemonTypes'

export const SORT_OPTIONS = {
  newest: { label: '최신 세트순', orderBy: '-set.releaseDate,number' },
  oldest: { label: '오래된 세트순', orderBy: 'set.releaseDate,number' },
  name: { label: '이름순', orderBy: 'name,-set.releaseDate' },
  number: { label: '번호순', orderBy: 'number,-set.releaseDate' },
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

function isSortKey(value: string): value is SortKey {
  return value in SORT_OPTIONS
}

export function filtersFromParams(params: URLSearchParams): CardFilters {
  const type = params.get('type') ?? ''
  const sort = params.get('sort') ?? ''
  return {
    name: params.get('q') ?? '',
    type: isPokemonType(type) ? type : '',
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
  if (filters.name.trim()) params.set('q', filters.name.trim())
  if (filters.type) params.set('type', filters.type)
  if (filters.set) params.set('set', filters.set)
  if (filters.rarity) params.set('rarity', filters.rarity)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  return params
}

/** Escape characters that have meaning inside a quoted Lucene phrase. */
function quote(value: string) {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/** Build the API `q` parameter, e.g. `name:"char*" types:Fire set.id:sv3pt5` */
export function toLuceneQuery(filters: CardFilters) {
  const parts: string[] = []
  const name = filters.name.trim().replace(/\*/g, '')
  if (name) parts.push(`name:${quote(`${name}*`)}`)
  if (filters.type) parts.push(`types:${filters.type}`)
  if (filters.set) parts.push(`set.id:${quote(filters.set)}`)
  if (filters.rarity) parts.push(`rarity:${quote(filters.rarity)}`)
  return parts.join(' ')
}

export function activeFilterCount(filters: CardFilters) {
  return [filters.name.trim(), filters.type, filters.set, filters.rarity].filter(Boolean).length
}
