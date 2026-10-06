import { POKEMON_TYPES, type PokemonType } from './pokemonTypes'

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

/** Collapse runs of whitespace and trim: what the URL stores and what the search box is compared with */
export function cleanName(raw: string) {
  return raw.replace(/\s+/g, ' ').trim()
}

const HANGUL = /[ㄱ-ㆎ가-힣]/
// Characters the API accepts inside a quoted name (it answers 400 to `"`, `(`, `\` and non-Latin scripts).
// Covers names like Farfetch'd, Mr. Mime, Porygon-Z, Nidoran♀, Flabébé, Type: Null.
const UNSEARCHABLE = /[^\p{Script=Latin}\p{N} .'’:&!?,/♀♂-]/gu

/** The part of the name the API can search for ('' if nothing usable is left) */
export function searchableName(raw: string) {
  return cleanName(raw.replace(UNSEARCHABLE, ' '))
}

/** Why a search term can't be sent as typed, or null if it can */
export function nameIssue(raw: string): 'hangul' | 'unsupported' | null {
  const name = cleanName(raw)
  if (!name) return null
  if (HANGUL.test(name)) return 'hangul'
  return searchableName(name) ? null : 'unsupported'
}

export function filtersFromParams(params: URLSearchParams): CardFilters {
  const rawType = (params.get('type') ?? '').toLowerCase()
  const type = POKEMON_TYPES.find((t) => t.toLowerCase() === rawType) ?? ''
  const sort = params.get('sort') ?? ''
  return {
    name: cleanName(params.get('q') ?? ''),
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

/** Escape characters that have meaning inside a quoted Lucene phrase. */
function quote(value: string) {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * Build the API `q` parameter, e.g. `name:"char*" types:Fire set.id:"sv3pt5"`.
 * Returns null when the search term can't be sent at all (see `nameIssue`).
 */
export function toLuceneQuery(filters: CardFilters): string | null {
  if (nameIssue(filters.name)) return null
  const parts: string[] = []
  const name = searchableName(filters.name)
  if (name) parts.push(`name:${quote(`${name}*`)}`)
  if (filters.type) parts.push(`types:${filters.type}`)
  if (filters.set) parts.push(`set.id:${quote(filters.set)}`)
  if (filters.rarity) parts.push(`rarity:${quote(filters.rarity)}`)
  return parts.join(' ')
}

export function activeFilterCount(filters: CardFilters) {
  return [cleanName(filters.name), filters.type, filters.set, filters.rarity].filter(Boolean).length
}
