import type { Card, CardSet, PagedResponse } from '../types/card'

// Same-origin proxy (api/tcg.ts on Vercel, vite.config.ts proxy in dev) in front of
// https://api.pokemontcg.io/v2. It retries upstream failures and holds the optional API key.
const BASE_URL = '/api/tcg'

// The upstream API intermittently answers 500/502. The proxy retries first; if it still gives
// up we retry here too, within an overall deadline. Healthy responses can still take 10s+.
const ATTEMPT_TIMEOUT_MS = 15_000
const DEADLINE_MS = 25_000
// 500s usually come back in under a second, so several quick retries are cheap.
const MAX_RETRIES = 4
const RETRY_BASE_DELAY_MS = 400

// Successful responses are reused for a while so back/forward and repeated filters are instant.
const CACHE_TTL_MS = 10 * 60_000
const responseCache = new Map<string, { expires: number; data: unknown }>()

export class ApiError extends Error {
  /** HTTP status, or undefined for network errors, timeouts and unreadable bodies */
  readonly status?: number
  /** The proxy's own "upstream unavailable" answer, given after it has already retried */
  readonly fromProxy: boolean

  constructor(message: string, status?: number, fromProxy = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fromProxy = fromProxy
  }

  get isNotFound() {
    return this.status === 404
  }
}

function isRetryable(error: unknown) {
  if (!(error instanceof ApiError)) return false
  // The proxy already retried upstream for ~12s before giving up; trying again only multiplies load
  if (error.fromProxy) return false
  return error.status === undefined || error.status >= 500 || error.status === 429
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
  if (res.status === 404) return new ApiError('카드를 찾을 수 없습니다.', 404)
  // api/tcg.ts marks its give-up response with X-Upstream-Status
  if (res.status === 502 && res.headers.has('X-Upstream-Status')) {
    return new ApiError('카드 서버가 응답하지 않습니다.', 502, true)
  }
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // body is not JSON
  }
  return new ApiError(`Pokémon TCG API ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
}

async function request<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(BASE_URL + path, window.location.origin)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const cacheKey = url.toString()
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.data as T

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

export interface CardQuery {
  /** Lucene-style query, e.g. `name:pikachu types:lightning` */
  q?: string
  page?: number
  pageSize?: number
  orderBy?: string
}

export function searchCards({ q, page = 1, pageSize = 24, orderBy }: CardQuery = {}, signal?: AbortSignal) {
  return request<PagedResponse<Card>>('/cards', { q, page, pageSize, orderBy }, signal)
}

export async function getCard(id: string, signal?: AbortSignal) {
  const { data } = await request<{ data: Card }>(`/cards/${encodeURIComponent(id)}`, undefined, signal)
  return data
}

export async function getSets(signal?: AbortSignal) {
  const { data } = await request<PagedResponse<CardSet>>(
    '/sets',
    { orderBy: '-releaseDate', pageSize: 250, select: 'id,name,series,releaseDate' },
    signal,
  )
  return data
}

export async function getRarities(signal?: AbortSignal) {
  const { data } = await request<{ data: string[] }>('/rarities', undefined, signal)
  return data
}
