import type { Card, CardListItem, CardSummary, PagedResponse } from '../types/card'

// Our own card API (server/cardsApi.ts): a Vercel Function in production, Vite middleware in dev.
const BASE_URL = '/api/cards'

// The data is served by us now, so failures are rare (cold starts, network blips): a couple of
// quick retries within an overall deadline are enough.
const ATTEMPT_TIMEOUT_MS = 10_000
const DEADLINE_MS = 15_000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 400

// Successful responses are reused for a while so back/forward and repeated filters are instant.
const CACHE_TTL_MS = 10 * 60_000
const responseCache = new Map<string, { expires: number; data: unknown }>()
// Prefetches still on the wire, so the page that needs the data joins them instead of asking again
const inflight = new Map<string, Promise<unknown>>()

export class ApiError extends Error {
  /** HTTP status, or undefined for network errors, timeouts and unreadable bodies */
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  get isNotFound() {
    return this.status === 404
  }
}

function isRetryable(error: unknown) {
  return error instanceof ApiError && (error.status === undefined || error.status >= 500)
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function attempt<T>(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  // Covers both the request and reading the body, so a stalled body also becomes an ApiError.
  const toApiError = (error: unknown, fallback: string) => {
    if (signal?.aborted) return error // caller cancelled: pass the AbortError through untouched
    if (timeout.aborted) return new ApiError('카드 서버 응답이 너무 늦습니다.')
    if (error instanceof ApiError) return error
    return new ApiError(fallback)
  }

  let res: Response
  try {
    res = await fetch(url, { signal: combined })
  } catch (error) {
    throw toApiError(error, '카드 서버에 연결하지 못했습니다.')
  }

  try {
    if (!res.ok) throw await errorFromResponse(res)
    return (await res.json()) as T
  } catch (error) {
    throw toApiError(error, '카드 서버 응답을 읽지 못했습니다.')
  }
}

async function errorFromResponse(res: Response) {
  let message = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    message = body.error?.message ?? ''
  } catch {
    // body is not JSON
  }
  if (res.status === 404) return new ApiError(message || '카드를 찾을 수 없습니다.', 404)
  return new ApiError(message || `카드 서버 오류 (${res.status})`, res.status)
}

type Params = Record<string, string | number | undefined>

function buildUrl(path: string, params?: Params) {
  const url = new URL(BASE_URL + path, window.location.origin)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url
}

/** A still-fresh cached response, without making a request */
function peek<T>(path: string, params?: Params): T | undefined {
  const cached = responseCache.get(buildUrl(path, params).toString())
  return cached && cached.expires > Date.now() ? (cached.data as T) : undefined
}

/** Waits for `promise`, but gives up (with the abort reason) as soon as `signal` aborts */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function request<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(path, params)
  const cacheKey = url.toString()
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.data as T

  const pending = inflight.get(cacheKey)
  if (pending) {
    try {
      return await untilAborted(pending as Promise<T>, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      // The prefetch failed: fall through to a request of our own (with its retries)
    }
  }

  const deadline = Date.now() + DEADLINE_MS
  for (let retry = 0; ; retry++) {
    const remaining = deadline - Date.now()
    try {
      const data = await attempt<T>(url, Math.min(ATTEMPT_TIMEOUT_MS, remaining), signal)
      responseCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, data })
      return data
    } catch (error) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** retry
      const hasTime = deadline - Date.now() > delay + 1_000
      if (retry >= MAX_RETRIES || !isRetryable(error) || !hasTime || signal?.aborted) throw error
      await sleep(delay, signal)
    }
  }
}

/** Search parameters, as sent to GET /api/cards */
export interface CardSearchParams {
  name?: string
  type?: string
  set?: string
  rarity?: string
  sort?: string
  page?: number
  pageSize?: number
}

const searchParams = ({ page = 1, pageSize = 24, ...rest }: CardSearchParams): Params => ({ ...rest, page, pageSize })

export function searchCards(params: CardSearchParams, signal?: AbortSignal) {
  return request<PagedResponse<CardListItem>>('', searchParams(params), signal)
}

/**
 * Starts a search before anything renders (see main.tsx), so the first list request overlaps
 * with loading the app instead of waiting for it. A later identical `searchCards` joins it.
 */
export function prefetchSearchCards(params: CardSearchParams) {
  const key = buildUrl('', searchParams(params)).toString()
  if (inflight.has(key)) return
  const promise = request('', searchParams(params))
  inflight.set(key, promise)
  promise.catch(() => {}).finally(() => inflight.delete(key))
}

/** The cached result of an identical `searchCards` call, so a revisited page can render at once */
export function peekSearchCards(params: CardSearchParams) {
  return peek<PagedResponse<CardListItem>>('', searchParams(params))
}

const cardPath = (id: string) => `/${encodeURIComponent(id)}`

export async function getCard(id: string, signal?: AbortSignal) {
  const { data } = await request<{ data: Card }>(cardPath(id), undefined, signal)
  return data
}

/** The cards right before and after this one in its set's order */
export function getSetNeighbors(id: string, signal?: AbortSignal) {
  return request<{ prev: CardSummary | null; next: CardSummary | null }>(`${cardPath(id)}/neighbors`, undefined, signal)
}

/** Other printings of the same Pokémon, or other cards with the same name */
export async function getRelatedCards(id: string, limit: number, signal?: AbortSignal) {
  const res = await request<{ data: CardListItem[]; totalCount: number }>(`${cardPath(id)}/related`, { limit }, signal)
  return { cards: res.data, totalCount: res.totalCount }
}
