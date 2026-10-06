import type { Card, PagedResponse } from '../types/card'

const BASE_URL = 'https://api.pokemontcg.io/v2'

// Optional: the API works without a key, a key only raises the rate limit.
const API_KEY = import.meta.env.VITE_POKEMON_TCG_API_KEY as string | undefined

const TIMEOUT_MS = 15_000
// The API intermittently answers 500/502 (and those responses lack CORS headers,
// so the browser reports them as a network TypeError), so retry transient failures.
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 600

export class ApiError extends Error {
  /** HTTP status, or undefined for network errors and timeouts */
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
  if (error instanceof ApiError) return error.status === undefined || error.status >= 500 || error.status === 429
  return false
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchOnce(url: URL, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: API_KEY ? { 'X-Api-Key': API_KEY } : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    // Caller cancelled: let the AbortError through untouched
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new ApiError('카드 서버 응답이 너무 늦습니다.')
    throw new ApiError('카드 서버에 연결하지 못했습니다.')
  }
}

async function errorFromResponse(res: Response) {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // body is not JSON
  }
  if (res.status === 404) return new ApiError('카드를 찾을 수 없습니다.', 404)
  return new ApiError(`Pokémon TCG API ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
}

async function request<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(BASE_URL + path)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchOnce(url, signal)
      if (!res.ok) throw await errorFromResponse(res)
      return (await res.json()) as T
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isRetryable(error) || signal?.aborted) throw error
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
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
