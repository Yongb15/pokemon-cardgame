import type { Card, PagedResponse } from '../types/card'

const BASE_URL = 'https://api.pokemontcg.io/v2'

// Optional: the API works without a key, a key only raises the rate limit.
const API_KEY = import.meta.env.VITE_POKEMON_TCG_API_KEY as string | undefined

async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(BASE_URL + path)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const res = await fetch(url, {
    headers: API_KEY ? { 'X-Api-Key': API_KEY } : undefined,
  })
  if (!res.ok) {
    throw new Error(`Pokémon TCG API ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export interface CardQuery {
  /** Lucene-style query, e.g. `name:pikachu types:lightning` */
  q?: string
  page?: number
  pageSize?: number
  orderBy?: string
}

export function searchCards({ q, page = 1, pageSize = 24, orderBy }: CardQuery = {}) {
  return request<PagedResponse<Card>>('/cards', { q, page, pageSize, orderBy })
}

export async function getCard(id: string) {
  const { data } = await request<{ data: Card }>(`/cards/${encodeURIComponent(id)}`)
  return data
}
