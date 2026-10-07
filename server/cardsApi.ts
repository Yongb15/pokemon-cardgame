// The card API, answered from the data built by scripts/build-data.mjs.
// Shared by the Vercel Function (api/cards.ts) and the Vite dev server (vite.config.ts).
//
//   GET /api/cards?name=&type=&set=&rarity=&sort=&page=&pageSize=   search
//   GET /api/cards/:id                                              one card, full details
//   GET /api/cards/:id/neighbors                                    previous/next card in its set
//   GET /api/cards/:id/related?limit=                               other printings

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
const numberOrder = new Intl.Collator('en', { numeric: true })
const koOrder = new Intl.Collator('ko', { numeric: true })

/** Lowercase, strip accents, spacing and punctuation: "Flabébé" → "flabebe", "메가 리자몽" → "메가리자몽" */
function normalize(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
  return { id: set.id, name: set.name, series: set.series, releaseDate: set.releaseDate, images: set.images }
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
    images: { small: c.image },
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

function intParam(params: URLSearchParams, name: string, fallback: number, max: number) {
  const value = Number(params.get(name) ?? fallback)
  return Number.isInteger(value) && value >= 1 ? Math.min(value, max) : null
}

async function search(params: URLSearchParams) {
  const store = await loadStore()
  const page = intParam(params, 'page', 1, 10_000)
  const pageSize = intParam(params, 'pageSize', 24, 250)
  if (page === null || pageSize === null) return badRequest('page와 pageSize는 1 이상의 정수여야 합니다.')
  const sortKey = (params.get('sort') ?? 'newest') as keyof typeof SORTS
  if (!(sortKey in SORTS)) return badRequest('알 수 없는 정렬입니다.')

  const name = normalize(params.get('name') ?? '')
  const type = params.get('type')
  const set = params.get('set')
  const rarity = params.get('rarity')

  const matches = store.cards.filter(
    (c) =>
      (!name || c.search.includes(name)) &&
      (!type || c.types?.includes(type)) &&
      (!set || c.set === set) &&
      (!rarity || c.rarity === rarity),
  )
  matches.sort(SORTS[sortKey](store))
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
  return json({ data: { ...raw, set: { ...setSummary(set), printedTotal: set.printedTotal, total: set.total } } })
}

async function neighbors(id: string) {
  const store = await loadStore()
  const entry = store.byId.get(id)
  if (!entry) return notFound()
  const order = store.setOrder.get(entry.set)!
  const i = order.indexOf(id)
  const summary = (otherId: string | undefined) => {
    const c = otherId && store.byId.get(otherId)
    return c ? { id: c.id, name: c.name, ...(c.nameKo && { nameKo: c.nameKo }), number: c.number, images: { small: c.image } } : null
  }
  return json({ prev: summary(order[i - 1]), next: summary(order[i + 1]) })
}

async function related(id: string, params: URLSearchParams) {
  const store = await loadStore()
  const entry = store.byId.get(id)
  if (!entry) return notFound()
  const limit = intParam(params, 'limit', 6, 24)
  if (limit === null) return badRequest('limit은 1 이상의 정수여야 합니다.')
  // A single Pokémon: every printing of it (by Pokédex number). TAG TEAM / multi-Pokémon cards,
  // Trainers and Energy: the exact same name.
  const dex = entry.dex?.length === 1 ? entry.dex[0] : undefined
  const same = store.cards.filter((c) => c.id !== id && (dex ? c.dex?.includes(dex) : c.name === entry.name))
  same.sort(SORTS.newest(store))
  return json({ data: same.slice(0, limit).map((c) => listItem(store, c)), totalCount: same.length })
}

/** Routes a request under /api/cards. `rest` is the path after /api/cards ('' for the search). */
export async function handleCards(rest: string, params: URLSearchParams): Promise<Response> {
  const segments = rest.split('/').filter(Boolean).map(decodeURIComponent)
  try {
    if (segments.length === 0) return await search(params)
    const [id, sub, ...extra] = segments
    if (extra.length || !/^[\w.-]+$/.test(id)) return notFound()
    if (!sub) return await card(id)
    if (sub === 'neighbors') return await neighbors(id)
    if (sub === 'related') return await related(id, params)
    return notFound()
  } catch (error) {
    console.error(error)
    return json({ error: { message: '카드 데이터를 읽지 못했습니다.', code: 500 } }, 500)
  }
}
