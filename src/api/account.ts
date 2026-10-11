// The account API (apps/api on Cloud Run, reached through the site's own /api/v1 proxy, so the
// session cookie is first-party and there's no CORS). Shapes: docs/auth/design.md "5단계 API".

export type Provider = 'google' | 'kakao' | 'test'

export interface AccountUser {
  nickname: string
  providers: Provider[]
}

/** A failed call: the status and the server's Korean message (generic for 5xx and network errors) */
export class AccountApiError extends Error {
  readonly status: number
  /** Seconds to wait (429) */
  readonly retryAfter: number | null

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message)
    this.name = 'AccountApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

const NETWORK = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SERVER = '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'

/** Called on any 401 from a signed-in route: the session ended (expired, or signed out elsewhere) */
let onSignedOut: (() => void) | null = null
export function setSignedOutHandler(handler: () => void) {
  onSignedOut = handler
}

export async function accountFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new AccountApiError(NETWORK, 0)
  }
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  if (!res.ok) {
    if (res.status === 401) onSignedOut?.()
    const message = res.status < 500 && typeof body?.error?.message === 'string' ? body.error.message : SERVER
    const retry = Number(res.headers.get('Retry-After'))
    throw new AccountApiError(message, res.status, Number.isFinite(retry) && retry > 0 ? retry : null)
  }
  return body as T
}

export const getMe = (signal?: AbortSignal) => accountFetch<{ user: AccountUser | null }>('/me', { signal })
export const logout = () => accountFetch<void>('/auth/logout', { method: 'POST' })
export const getSummary = () => accountFetch<{ decks: number; favorites: number }>('/me/summary')
export const renameMe = (nickname: string) => accountFetch<{ user: AccountUser }>('/me', { method: 'PATCH', body: { nickname } })
export const logoutEverywhere = () => accountFetch<void>('/me/logout-all', { method: 'POST' })
export const leave = (confirm: string) => accountFetch<void>('/me', { method: 'DELETE', body: { confirm } })

/** Where the sign-in buttons go: a full page load, so the API can set its cookie and redirect */
export const signInUrl = (provider: 'google' | 'kakao', next: string) =>
  `/api/v1/auth/${provider}/start?${new URLSearchParams({ next })}`

/** Only a path on this site (the API checks again): "/decks?x" yes, "//evil.com" or "https:…" no */
export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.length > 200) return '/'
  return value.startsWith('/login') ? '/' : value
}

export const getFavorites = () => accountFetch<{ cards: string[] }>('/favorites')
export const addFavorite = (cardId: string) => accountFetch<void>(`/favorites/${encodeURIComponent(cardId)}`, { method: 'PUT' })
export const removeFavorite = (cardId: string) =>
  accountFetch<void>(`/favorites/${encodeURIComponent(cardId)}`, { method: 'DELETE' })

// --- Account decks (docs/auth/design.md "5단계 API") ---------------------------------------------

export interface AccountDeckBody {
  name: string
  format: 'standard' | 'expanded' | 'unlimited'
  cards: { id: string; count: number }[]
  coverId: string | null
  problems: number | null
}

export interface AccountDeck extends AccountDeckBody {
  id: string
  version: number
  updatedAt: string
}

export interface ImportResult {
  imported: { sourceId: string; id: string }[]
  duplicates: string[]
  overLimit: string[]
  invalid: number
}

export const listAccountDecks = () => accountFetch<{ decks: AccountDeck[] }>('/decks')
export const getAccountDeck = (id: string) => accountFetch<{ deck: AccountDeck }>(`/decks/${encodeURIComponent(id)}`)
export const createAccountDeck = (body: AccountDeckBody) => accountFetch<{ deck: AccountDeck }>('/decks', { method: 'POST', body })
export const saveAccountDeck = (id: string, body: AccountDeckBody, version: number) =>
  accountFetch<{ deck: AccountDeck }>(`/decks/${encodeURIComponent(id)}`, { method: 'PUT', body: { ...body, version } })
export const deleteAccountDeck = (id: string) => accountFetch<void>(`/decks/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const importDecks = (decks: (AccountDeckBody & { sourceId: string; updatedAt: number })[]) =>
  accountFetch<ImportResult>('/decks/import', { method: 'POST', body: { decks } })

// --- Points (M7 7a, docs/auction/design.md) ------------------------------------------------------

export interface PointsSummary {
  balance: number
  held: number
  available: number
  /** Today in Korea (YYYY-MM-DD) */
  today: string
  claimedToday: boolean
  /** The first bonus was granted by this very call */
  bonusGranted: boolean
}

export type PointKind = 'signup_bonus' | 'daily_bonus' | 'pack_purchase' | 'sale_income' | 'sale_fee' | 'purchase' | 'admin_adjust'

export interface PointEntry {
  id: string
  amount: number
  kind: PointKind
  createdAt: string
}

export const getPoints = () => accountFetch<PointsSummary>('/me/points')
export const getPointEntries = (before: string | null) =>
  accountFetch<{ entries: PointEntry[]; next: string | null }>(`/me/points/entries${before ? `?${new URLSearchParams({ before })}` : ''}`)
export const claimDaily = () => accountFetch<PointsSummary & { claimed: boolean }>('/me/points/daily', { method: 'POST' })

// --- Card packs and the collection (M7 7b, docs/auction/packs.md) --------------------------------

export type PackTier = 'common' | 'uncommon' | 'rare' | 'double' | 'illustration' | 'ultra' | 'sir' | 'hyper'

export interface PackCatalog {
  price: number
  size: number
  sets: { id: string; nameKo: string; releaseDate: string; cards: number; odds: { tier: PackTier; percent: number; cards: number }[] }[]
}

export interface PackCard {
  cardId: string
  tier: PackTier
  rareSlot: boolean
  isNew: boolean
}

export interface OpenedPack {
  id: string
  setId: string
  cards: PackCard[]
  createdAt: string
}

export interface CollectionCard {
  cardId: string
  count: number
  test: number
  /** Copies in an open auction */
  listed: number
  newest: string
}

export interface CollectionSummary {
  cards: number
  distinct: number
  sets: { id: string; owned: number; total: number }[]
  /** Copies per card (test copies excluded) */
  owned: { cardId: string; count: number }[]
}

export const getPackCatalog = () => accountFetch<PackCatalog>('/packs')
export const openPack = (setId: string, idemKey: string) =>
  accountFetch<{ kind: 'opened' | 'repeat'; pack: OpenedPack; points: PointsSummary }>('/me/packs', { method: 'POST', body: { setId, idemKey } })
export const getLatestPack = () => accountFetch<{ pack: OpenedPack | null }>('/me/packs/latest')
export const getCollection = (set: string | null, page: number) =>
  accountFetch<{ cards: CollectionCard[]; more: boolean }>(`/me/collection?${new URLSearchParams({ ...(set && { set }), ...(page > 0 && { page: String(page) }) })}`)
export const getCollectionSummary = () => accountFetch<CollectionSummary>('/me/collection/summary')

// --- Auctions (M7 7c, docs/auction/design.md) ----------------------------------------------------

export type AuctionStatus = 'open' | 'ending' | 'sold' | 'unsold' | 'cancelled'

export interface AuctionState {
  id: string
  cardId: string
  status: AuctionStatus
  startPrice: number
  minStep: number
  minBid: number
  topAmount: number | null
  topAlias: string | null
  bidCount: number
  endsAt: string
  extensions: number
  maxExtensions: number
  version: number
  closedAt: string | null
  bids: { alias: string; amount: number; at: string }[]
}

export interface AuctionMine {
  isSeller: boolean
  isTop: boolean
  myAlias: string | null
  held: number
}

export interface MarketItem {
  id: string
  cardId: string
  price: number
  hasBids: boolean
  bidCount: number
  endsAt: string
  status: AuctionStatus
}

export type BidOutcome =
  | { kind: 'ok' | 'repeat'; version: number }
  | { kind: 'closed' | 'ended' | 'own' }
  | { kind: 'too_low'; minBid: number }
  | { kind: 'insufficient'; available: number; need: number }

export const getMarket = (sort: 'ending' | 'new' | 'price', page = 0) =>
  accountFetch<{ items: MarketItem[]; more: boolean }>(`/auctions?${new URLSearchParams({ sort, ...(page > 0 && { page: String(page) }) })}`)
/** The public, briefly cached state (not for setting the clock: qa) */
export const getAuction = (id: string, signal?: AbortSignal) => accountFetch<AuctionState>(`/auctions/${encodeURIComponent(id)}`, { signal })
export const getMyAuction = (id: string) => accountFetch<{ mine: AuctionMine; serverNow: string }>(`/me/auctions/${encodeURIComponent(id)}`)
export const getMyAuctions = () => accountFetch<{ selling: MarketItem[]; bidding: MarketItem[] }>('/me/auctions')
export const createAuction = (cardId: string, startPrice: number, duration: string, idemKey: string) =>
  accountFetch<{ auctionId: string }>('/me/auctions', { method: 'POST', body: { cardId, startPrice, duration, idemKey } })
export const placeBid = (id: string, amount: number, idemKey: string) =>
  accountFetch<{ result: BidOutcome; state: AuctionState; mine: AuctionMine; serverNow: string }>(`/me/auctions/${encodeURIComponent(id)}/bids`, {
    method: 'POST',
    body: { amount, idemKey },
  })
export const cancelAuction = (id: string) => accountFetch<{ result: 'ok' }>(`/me/auctions/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

/** Auction notifications (docs/auction/design.md §7d): the newest 20 and how many are unread */
export interface NotificationItem {
  id: string
  kind: 'outbid' | 'won' | 'sold' | 'unsold'
  auctionId: string
  cardId: string
  amount: number | null
  at: string
  read: boolean
}
export const getNotifications = () => accountFetch<{ unread: number; items: NotificationItem[] }>('/me/notifications')
export const markNotificationsRead = () => accountFetch<{ unread: 0 }>('/me/notifications/read', { method: 'POST' })
