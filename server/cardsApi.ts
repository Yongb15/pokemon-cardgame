// The card API, answered from the data built by scripts/build-data.mjs.
// Shared by the Vercel Function (api/cards.ts) and the Vite dev server (vite.config.ts).
//
//   GET /api/cards?name=&type=&set=&rarity=&sort=&page=&pageSize=   search
//   GET /api/cards/:id                                              one card, full details
//   GET /api/cards/:id/neighbors                                    previous/next card in its set
//   GET /api/cards/:id/related?limit=                               other printings

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

interface IndexEntry {
  id: string
  name: string
  nameKo?: string
  supertype: string
  subtypes?: string[]
  hp?: string
  types?: string[]
  number: string
  rarity?: string
  dex?: number[]
  set: string
  image: string
}

interface SetInfo {
  id: string
  name: string
  series: string
  printedTotal?: number
  total?: number
  releaseDate: string
  images: { symbol: string; logo: string }
}

type RawCard = { id: string; nationalPokedexNumbers?: number[] } & Record<string, unknown>

interface Store {
  cards: (IndexEntry & { search: string })[]
  byId: Map<string, IndexEntry>
  sets: Map<string, SetInfo>
  /** Card ids per set, in set-number order */
  setOrder: Map<string, string[]>
}

const DATA_DIR = path.join(process.cwd(), 'data')

// Card images we host ourselves (scripts/build-images.mjs → GitHub Pages), so they outlive the
// Pokémon TCG API. The original URLs ride along as a fallback for any image we don't have.
const IMAGE_HOST = {
  sm: 'https://yongb15.github.io/pokemon-card-images-sm',
  lg: 'https://yongb15.github.io/pokemon-card-images-lg',
}

/** Same file-name rule as scripts/build-images.mjs: unsafe characters become their hex code, so ids stay distinct ("ex10-?" → "ex10-_3f", "ex10-!" → "ex10-_21") */
const imageName = (id: string) => id.replace(/[^\w.-]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}`)

// Cards with no image anywhere (scripts/build-images.mjs): no URLs, so the app shows its placeholder
// instead of the card back the image servers return
const missingImages = new Set<string>(JSON.parse(readFileSync(path.join(DATA_DIR, 'missing-images.json'), 'utf8')))

function images(setId: string, id: string, original: { small: string; large?: string }) {
  if (missingImages.has(id)) return { small: '', large: '' }
  return {
    small: `${IMAGE_HOST.sm}/${setId}/${imageName(id)}.webp`,
    large: `${IMAGE_HOST.lg}/${setId}/${imageName(id)}.webp`,
    fallbackSmall: original.small,
    fallbackLarge: original.large ?? original.small,
  }
}
const numberOrder = new Intl.Collator('en', { numeric: true })
const koOrder = new Intl.Collator('ko', { numeric: true })

/** Lowercase, strip accents, spacing and punctuation: "Flabébé" → "flabebe", "메가 리자몽" → "메가리자몽" */
function normalize(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // NFKD also splits Hangul syllables into jamo ("리" would match "릴"); put them back together
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

let storePromise: Promise<Store> | null = null

/** Loaded once per server instance and kept in memory (≈5 MB). */
function loadStore() {
  storePromise ??= (async () => {
    const [index, sets] = await Promise.all([
      readFile(path.join(DATA_DIR, 'index.json'), 'utf8').then((t) => JSON.parse(t) as IndexEntry[]),
      readFile(path.join(DATA_DIR, 'sets.json'), 'utf8').then((t) => JSON.parse(t) as SetInfo[]),
    ])
    const setMap = new Map(sets.map((s) => [s.id, s]))
    const setOrder = new Map<string, string[]>()
    for (const card of [...index].sort((a, b) => numberOrder.compare(a.number, b.number))) {
      setOrder.set(card.set, [...(setOrder.get(card.set) ?? []), card.id])
    }
    return {
      cards: index.map((c) => ({ ...c, search: normalize(c.name) + ' ' + normalize(c.nameKo ?? '') })),
      byId: new Map(index.map((c) => [c.id, c])),
      sets: setMap,
      setOrder,
    }
  })().catch((error: unknown) => {
    storePromise = null
    throw error
  })
  return storePromise
}

const setCache = new Map<string, Promise<RawCard[]>>()
function loadSetCards(setId: string) {
  let pending = setCache.get(setId)
  if (!pending) {
    pending = readFile(path.join(DATA_DIR, 'cards', `${setId}.json`), 'utf8').then((t) => JSON.parse(t) as RawCard[])
    setCache.set(setId, pending)
  }
  return pending
}

function setSummary(set: SetInfo) {
  const hosted = `${IMAGE_HOST.sm}/_sets/${set.id}`
  return {
    id: set.id,
    name: set.name,
    series: set.series,
    releaseDate: set.releaseDate,
    images: {
      logo: `${hosted}/logo.png`,
      symbol: `${hosted}/symbol.png`,
      fallbackLogo: set.images.logo,
      fallbackSymbol: set.images.symbol,
    },
  }
}

/** The shape the list page renders (a subset of the full card) */
function listItem(store: Store, c: IndexEntry) {
  const set = store.sets.get(c.set)!
  return {
    id: c.id,
    name: c.name,
    ...(c.nameKo && { nameKo: c.nameKo }),
    supertype: c.supertype,
    subtypes: c.subtypes,
    hp: c.hp,
    types: c.types,
    number: c.number,
    rarity: c.rarity,
    set: setSummary(set),
    images: images(c.set, c.id, { small: c.image }),
  }
}

const SORTS = {
  newest: (s: Store) => (a: IndexEntry, b: IndexEntry) =>
    (s.sets.get(b.set)!.releaseDate.localeCompare(s.sets.get(a.set)!.releaseDate) || a.set.localeCompare(b.set)) ||
    numberOrder.compare(a.number, b.number),
  oldest: (s: Store) => (a: IndexEntry, b: IndexEntry) =>
    (s.sets.get(a.set)!.releaseDate.localeCompare(s.sets.get(b.set)!.releaseDate) || a.set.localeCompare(b.set)) ||
    numberOrder.compare(a.number, b.number),
  // Korean names first where they exist, so "이름순" reads naturally in a Korean UI
  name: (s: Store) => (a: IndexEntry, b: IndexEntry) =>
    koOrder.compare(a.nameKo ?? a.name, b.nameKo ?? b.name) || SORTS.newest(s)(a, b),
  number: (s: Store) => (a: IndexEntry, b: IndexEntry) => numberOrder.compare(a.number, b.number) || SORTS.newest(s)(a, b),
} as const

type SortKey = keyof typeof SORTS
type StoreCard = Store['cards'][number]

// Sorting 20k cards per request is the expensive part of a search, and requests that miss the
// edge cache (any new query string) would pay it every time. Sort each order once per instance.
const sortedCache = new Map<SortKey, StoreCard[]>()
function sortedCards(store: Store, key: SortKey) {
  let sorted = sortedCache.get(key)
  if (!sorted) {
    sorted = [...store.cards].sort(SORTS[key](store))
    sortedCache.set(key, sorted)
  }
  return sorted
}

const MAX_NAME_LENGTH = 50

const CACHE = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The data only changes with a deploy, so let the edge keep responses for a day
      'Cache-Control': status === 200 || status === 404 ? CACHE : 'no-store',
    },
  })
}

const notFound = (message = '카드를 찾을 수 없습니다.') => json({ error: { message, code: 404 } }, 404)
const badRequest = (message: string) => json({ error: { message, code: 400 } }, 400)

/** A positive integer up to `max`, or null (→ 400) for anything else */
function intParam(params: URLSearchParams, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(params.get(name) ?? fallback)
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null
}

async function search(params: URLSearchParams) {
  const store = await loadStore()
  const page = intParam(params, 'page', 1)
  const pageSize = intParam(params, 'pageSize', 24, 250)
  if (page === null || pageSize === null) return badRequest('page는 1 이상, pageSize는 1~250 사이의 정수여야 합니다.')
  const sortKey = params.get('sort') ?? 'newest'
  // Own keys only: `in` would accept "constructor", "__proto__" and friends
  if (!Object.hasOwn(SORTS, sortKey)) return badRequest('알 수 없는 정렬입니다.')

  const rawName = params.get('name') ?? ''
  if (rawName.length > MAX_NAME_LENGTH) return badRequest(`검색어는 ${MAX_NAME_LENGTH}자 이하여야 합니다.`)
  const name = normalize(rawName)
  // Only punctuation ("!!!"): nothing can match, rather than silently ignoring the search
  if (rawName.trim() && !name) return json({ data: [], page, pageSize, count: 0, totalCount: 0 })
  const type = params.get('type')
  const set = params.get('set')
  const rarity = params.get('rarity')

  // Filtering a pre-sorted list keeps its order
  const matches = sortedCards(store, sortKey as SortKey).filter(
    (c) =>
      (!name || c.search.includes(name)) &&
      (!type || c.types?.includes(type)) &&
      (!set || c.set === set) &&
      (!rarity || c.rarity === rarity),
  )
  const start = (page - 1) * pageSize
  const data = matches.slice(start, start + pageSize).map((c) => listItem(store, c))
  return json({ data, page, pageSize, count: data.length, totalCount: matches.length })
}

async function card(id: string) {
  const store = await loadStore()
  const entry = store.byId.get(id)
  if (!entry) return notFound()
  const raw = (await loadSetCards(entry.set)).find((c) => c.id === id)
  if (!raw) return notFound()
  const set = store.sets.get(entry.set)!
  return json({
    data: {
      ...raw,
      images: images(entry.set, id, raw.images as { small: string; large?: string }),
      set: { ...setSummary(set), printedTotal: set.printedTotal, total: set.total },
    },
  })
}

async function neighbors(id: string) {
  const store = await loadStore()
  const entry = store.byId.get(id)
  if (!entry) return notFound()
  const order = store.setOrder.get(entry.set)!
  const i = order.indexOf(id)
  const summary = (otherId: string | undefined) => {
    const c = otherId && store.byId.get(otherId)
    return c ? { id: c.id, name: c.name, ...(c.nameKo && { nameKo: c.nameKo }), number: c.number, images: images(c.set, c.id, { small: c.image }) } : null
  }
  return json({ prev: summary(order[i - 1]), next: summary(order[i + 1]) })
}

async function related(id: string, params: URLSearchParams) {
  const store = await loadStore()
  const entry = store.byId.get(id)
  if (!entry) return notFound()
  const limit = intParam(params, 'limit', 6, 24)
  if (limit === null) return badRequest('limit은 1~24 사이의 정수여야 합니다.')
  // A single Pokémon: every printing of it (by Pokédex number). TAG TEAM cards ("A & B", whose
  // Pokédex numbers are sometimes incomplete in the data), Trainers and Energy: the exact name.
  const single = entry.dex?.length === 1 && !entry.name.includes(' & ')
  const dex = single ? entry.dex![0] : undefined
  const same = sortedCards(store, 'newest').filter((c) => c.id !== id && (dex ? c.dex?.includes(dex) : c.name === entry.name))
  return json({ data: same.slice(0, limit).map((c) => listItem(store, c)), totalCount: same.length })
}

/** Routes a request under /api/cards. `rest` is the path after /api/cards ('' for the search). */
export async function handleCards(rest: string, params: URLSearchParams): Promise<Response> {
  try {
    // Vercel's rewrite hands us a decoded path, the dev server an encoded one
    let segments = rest.split('/').filter(Boolean)
    try {
      segments = segments.map(decodeURIComponent)
    } catch {
      // already decoded and contains a literal "%": use as is
    }
    if (segments.length === 0) return await search(params)
    const [id, sub, ...extra] = segments
    // The byId lookup is what guards file access (paths come only from trusted data); this check
    // just rejects obvious junk early. "!" and "?" occur in real ids (Unown ex10-!, ex10-?).
    if (extra.length || !/^[\w.!?-]+$/.test(id)) return notFound()
    if (!sub) return await card(id)
    if (sub === 'neighbors') return await neighbors(id)
    if (sub === 'related') return await related(id, params)
    return notFound()
  } catch (error) {
    console.error(error)
    return json({ error: { message: '카드 데이터를 읽지 못했습니다.', code: 500 } }, 500)
  }
}
