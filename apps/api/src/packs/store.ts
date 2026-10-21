// Card packs and the collection (docs/auction/packs.md). Opening a pack is one transaction, in the
// lock order every points change keeps (Security K-2): the user's point account first, then the
// writes. A request id (idem_key) makes a retry return the pack it already opened — even with a
// different set — without charging again.

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { credit, lockAccount } from '../points/store.js'
import { BUNDLE_SIZE, CRAFT_FACTOR, drawBundle, drawPack, EXCHANGE_VALUE, PACK_PRICE, PACK_SETS, packSet, tierOf, type DrawnCard, type Rng, type Tier } from './odds.js'

/** Exchange and craft limits (docs/auction/exchange.md, Security X-7) */
export const EXCHANGE_MAX = 50
export const EXCHANGE_DAILY_POINTS = 50_000
export const CRAFT_DAILY = 20

export const COLLECTION_PAGE = 60

export const PACKS_PRIVILEGES: [string, string | null, string][] = [
  ['pack_openings', null, 'SELECT'],
  ['pack_openings', 'user_id', 'INSERT'],
  ['pack_openings', 'set_id', 'INSERT'],
  ['pack_openings', 'cost', 'INSERT'],
  ['pack_openings', 'cards', 'INSERT'],
  ['pack_openings', 'seeded', 'INSERT'],
  ['pack_openings', 'idem_key', 'INSERT'],
  ['pack_openings', 'bundle_idx', 'INSERT'],
  ['owned_cards', null, 'SELECT'],
  ['owned_cards', 'user_id', 'INSERT'],
  ['owned_cards', 'card_id', 'INSERT'],
  ['owned_cards', 'source', 'INSERT'],
  ['owned_cards', 'pack_id', 'INSERT'],
]

/** Must NOT be granted (Security: no DELETE; nothing is edited before 7c) */
export const PACKS_EXCESS: [string, string | null, string][] = [
  ['pack_openings', null, 'UPDATE'],
  ['pack_openings', null, 'DELETE'],
  ['owned_cards', null, 'DELETE'],
  ['owned_cards', 'card_id', 'UPDATE'],
  ['owned_cards', 'source', 'UPDATE'],
]

export interface PackCard extends DrawnCard {
  /** The user didn't own this card before the pack */
  isNew: boolean
}

export interface OpenedPack {
  id: string
  setId: string
  cards: PackCard[]
  createdAt: Date
}

export type OpenResult =
  | { kind: 'opened' | 'repeat'; packs: OpenedPack[]; guaranteed: boolean }
  | { kind: 'insufficient'; available: number }
  /** The request id already opened a different number of packs (Security X-5) */
  | { kind: 'conflict' }

export type ExchangeResult =
  | { kind: 'ok' | 'repeat'; exchanged: number; points: number }
  | { kind: 'not_found' }
  /** Fewer exchangeable copies than asked: `available` is how many could go now (one always stays) */
  | { kind: 'too_many'; available: number }
  | { kind: 'limit'; left: number }

export type CraftResult = { kind: 'ok' | 'repeat'; cost: number } | { kind: 'not_found' } | { kind: 'insufficient'; available: number; cost: number } | { kind: 'limit' }

export interface CollectionRow {
  cardId: string
  count: number
  /** Copies from the preview test hook (not counted towards set progress) */
  test: number
  /** Copies in an open auction right now */
  listed: number
  newest: Date
}

export interface CollectionSummary {
  cards: number
  distinct: number
  /** Per pack set: distinct cards owned (test copies excluded) out of what its packs can give */
  sets: { id: string; owned: number; total: number }[]
  /** Copies per card, test copies excluded: the browser prices these for the collection's value */
  owned: { cardId: string; count: number }[]
}

export interface PackCheck {
  /** My packs whose cards[] differ from the copies inserted with that pack id */
  mine: { packs: number; mismatched: number }
  all: { packs: number; mismatched: number }
}

export interface PacksStore {
  /** The packs a request id already opened, in order (no lock: a hint before the rate limit; open() decides) */
  prior(userId: string, idemKey: string): Promise<OpenedPack[] | null>
  /** One pack, or ten with the guarantee (docs/auction/exchange.md §1) */
  open(userId: string, setId: string, idemKey: string, count: 1 | 10, rng?: Rng, seeded?: boolean): Promise<OpenResult>
  /** Duplicates to points: the DB function deletes, this credits (exchange.md §2) */
  exchange(userId: string, cardId: string, count: number, idemKey: string): Promise<ExchangeResult>
  /** Points to one copy of a pack-pool card (exchange.md §3) */
  craft(userId: string, cardId: string, idemKey: string): Promise<CraftResult>
  latest(userId: string): Promise<OpenedPack | null>
  collection(userId: string, setId: string | null, page: number): Promise<{ rows: CollectionRow[]; more: boolean }>
  summary(userId: string): Promise<CollectionSummary>
  addTestCards(userId: string, cardId: string, count: number): Promise<void>
  packCheck(userId: string): Promise<PackCheck>
}

/** Which tier a card id is in, within its pack set (for showing an old pack again) */
const TIER_OF = new Map<string, Tier>(PACK_SETS.flatMap((s) => Object.entries(s.tiers).flatMap(([tier, ids]) => ids.map((id): [string, Tier] => [`${s.id}|${id}`, tier as Tier]))))

/** The stored five ids back as pack cards (the fifth is always the rare slot) */
export function asPackCards(setId: string, ids: string[], owned: Set<string> | null): PackCard[] {
  return ids.map((cardId, i) => ({ cardId, tier: TIER_OF.get(`${setId}|${cardId}`) ?? 'common', rareSlot: i === 4, isNew: owned ? !owned.has(cardId) : false }))
}

const setPrefix = (setId: string) => `${setId}-`

export class PgPacksStore implements PacksStore {
  constructor(private readonly db: NodePgDatabase) {}

  async open(userId: string, setId: string, idemKey: string, count: 1 | 10, rng?: Rng, seeded = false): Promise<OpenResult> {
    const set = packSet(setId)
    if (!set) throw new Error('unknown set')
    return this.db.transaction(async (tx) => {
      const account = await lockAccount(tx, userId)
      // A retry of a request we already served: the same packs, no second charge (K-2). One key, one row per
      // pack (bundle_idx), so a single pack's key can never match one pack of a bundle (Security X-5)
      const prior = await this.priorIn(tx, userId, idemKey)
      if (prior) return prior.length === count ? { kind: 'repeat', packs: prior, guaranteed: false } : { kind: 'conflict' }
      const cost = PACK_PRICE * count
      if (account.balance - account.held < cost) return { kind: 'insufficient', available: account.balance - account.held }

      const drawn = count === BUNDLE_SIZE ? drawBundle(set, rng) : { packs: [drawPack(set, rng)], guaranteed: false }
      // One JSON parameter: drizzle would spread a JS array into separate ones
      const allJson = JSON.stringify([...new Set(drawn.packs.flat().map((c) => c.cardId))])
      const owned = await tx.execute<{ card_id: string }>(
        sql`select distinct card_id from account.owned_cards where user_id = ${userId} and card_id in (select json_array_elements_text(${allJson}::json))`,
      )
      // A card is new only the first time it shows up, across all the packs of this request
      const seen = new Set(owned.rows.map((r) => r.card_id))
      const packs: OpenedPack[] = []
      for (const [i, cards] of drawn.packs.entries()) {
        const idsJson = JSON.stringify(cards.map((c) => c.cardId))
        const inserted = await tx.execute<{ id: string; created_at: Date }>(sql`
          insert into account.pack_openings (user_id, set_id, cost, cards, seeded, idem_key, bundle_idx)
          values (${userId}, ${setId}, ${PACK_PRICE}, array(select json_array_elements_text(${idsJson}::json)), ${seeded}, ${idemKey}, ${i})
          returning id, created_at`)
        const pack = inserted.rows[0]!
        // A single pack's ledger key is unchanged; a bundle's adds ':i' (':' can't appear in a request key)
        const charged = await credit(tx, userId, account, -PACK_PRICE, 'pack_purchase', pack.id, count === 1 ? `pack:${idemKey}` : `pack:${idemKey}:${i}`)
        if (charged !== 'ok') throw new Error(`pack charge ${charged}`) // rolls everything back
        await tx.execute(sql`
          insert into account.owned_cards (user_id, card_id, source, pack_id)
          select ${userId}, card_id, 'pack', ${pack.id}::uuid from json_array_elements_text(${idsJson}::json) as card_id`)
        packs.push({
          id: pack.id,
          setId,
          cards: cards.map((c) => {
            const isNew = !seen.has(c.cardId)
            seen.add(c.cardId)
            return { ...c, isNew }
          }),
          createdAt: new Date(pack.created_at),
        })
      }
      return { kind: 'opened', packs, guaranteed: drawn.guaranteed }
    })
  }

  private async priorIn(tx: Pick<NodePgDatabase, 'execute'>, userId: string, idemKey: string): Promise<OpenedPack[] | null> {
    const { rows } = await tx.execute<{ id: string; set_id: string; cards: string[]; created_at: Date }>(
      sql`select id, set_id, cards, created_at from account.pack_openings where user_id = ${userId} and idem_key = ${idemKey} order by bundle_idx`,
    )
    return rows.length ? rows.map((p) => ({ id: p.id, setId: p.set_id, cards: asPackCards(p.set_id, p.cards, null), createdAt: new Date(p.created_at) })) : null
  }

  async prior(userId: string, idemKey: string) {
    return this.priorIn(this.db, userId, idemKey)
  }

  async exchange(userId: string, cardId: string, count: number, idemKey: string): Promise<ExchangeResult> {
    const tier = tierOf(cardId)
    if (!tier) return { kind: 'not_found' }
    const ledgerKey = `exchange:${idemKey}`
    try {
      return await this.db.transaction(async (tx) => {
        // Lock order: the point account, then (inside the function) the card's copies (Security X-4)
        const account = await lockAccount(tx, userId)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exchange:${userId}`}, 0))`)
        const prior = await tx.execute<{ amount: string }>(sql`select amount from account.point_entries where user_id = ${userId} and idem_key = ${ledgerKey}`)
        if (prior.rows[0]) {
          const points = Number(prior.rows[0].amount)
          return { kind: 'repeat', exchanged: Math.round(points / EXCHANGE_VALUE[tier]), points }
        }
        const points = EXCHANGE_VALUE[tier] * count
        // Points from exchange today (Korea time, database clock: A-1)
        const today = await tx.execute<{ n: string }>(sql`
          select coalesce(sum(amount), 0) as n from account.point_entries
          where user_id = ${userId} and kind = 'card_exchange'
            and created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`)
        const left = EXCHANGE_DAILY_POINTS - Number(today.rows[0]!.n)
        if (points > left) return { kind: 'limit', left: Math.max(0, left) }
        const eligible = await this.exchangeable(tx, userId, cardId)
        if (count > eligible) return { kind: 'too_many', available: eligible }
        await tx.execute(sql`select account.exchange_cards(${userId}::uuid, ${cardId}, ${count}::int)`)
        const credited = await credit(tx, userId, account, points, 'card_exchange', cardId, ledgerKey)
        if (credited !== 'ok') throw new Error(`exchange credit ${credited}`)
        return { kind: 'ok', exchanged: count, points }
      })
    } catch (error) {
      // The function refused (a copy got listed meanwhile): say how many can go now
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
      if (code === 'P0001') return { kind: 'too_many', available: await this.exchangeable(this.db, userId, cardId) }
      throw error
    }
  }

  /** Copies of a card that may be exchanged now: not test copies, not in an open auction, and one of those always kept (I-x1) */
  private async exchangeable(tx: Pick<NodePgDatabase, 'execute'>, userId: string, cardId: string) {
    const { rows } = await tx.execute<{ total: number; free: number }>(sql`
      select count(*)::int as total,
             (count(*) filter (where o.source <> 'test' and o.auction_id is null
               and not exists (select 1 from account.auctions a where a.owned_card_id = o.id and a.status = 'open')))::int as free
      from account.owned_cards o where o.user_id = ${userId} and o.card_id = ${cardId}`)
    const r = rows[0]!
    return Math.max(0, Math.min(r.free - 1, EXCHANGE_MAX))
  }

  async craft(userId: string, cardId: string, idemKey: string): Promise<CraftResult> {
    const tier = tierOf(cardId)
    if (!tier) return { kind: 'not_found' }
    const cost = EXCHANGE_VALUE[tier] * CRAFT_FACTOR
    const ledgerKey = `craft:${idemKey}`
    return this.db.transaction(async (tx) => {
      const account = await lockAccount(tx, userId)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`craft:${userId}`}, 0))`)
      const prior = await tx.execute(sql`select 1 from account.point_entries where user_id = ${userId} and idem_key = ${ledgerKey}`)
      if (prior.rows.length) return { kind: 'repeat', cost }
      const today = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from account.point_entries
        where user_id = ${userId} and kind = 'card_craft'
          and created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`)
      if (today.rows[0]!.n >= CRAFT_DAILY) return { kind: 'limit' }
      const available = account.balance - account.held
      if (available < cost) return { kind: 'insufficient', available, cost }
      await tx.execute(sql`insert into account.owned_cards (user_id, card_id, source) values (${userId}, ${cardId}, 'craft')`)
      const charged = await credit(tx, userId, account, -cost, 'card_craft', cardId, ledgerKey)
      if (charged !== 'ok') throw new Error(`craft charge ${charged}`)
      return { kind: 'ok', cost }
    })
  }

  async latest(userId: string) {
    const { rows } = await this.db.execute<{ id: string; set_id: string; cards: string[]; created_at: Date }>(
      sql`select id, set_id, cards, created_at from account.pack_openings where user_id = ${userId} order by created_at desc limit 1`,
    )
    const p = rows[0]
    return p ? { id: p.id, setId: p.set_id, cards: asPackCards(p.set_id, p.cards, null), createdAt: new Date(p.created_at) } : null
  }

  async collection(userId: string, setId: string | null, page: number) {
    const { rows } = await this.db.execute<{ card_id: string; n: number; test: number; listed: number; newest: Date }>(sql`
      select card_id, count(*)::int as n, (count(*) filter (where source = 'test'))::int as test,
             (count(*) filter (where auction_id is not null))::int as listed, max(acquired_at) as newest
      from account.owned_cards
      where user_id = ${userId} ${setId ? sql`and starts_with(card_id, ${setPrefix(setId)})` : sql``}
      group by card_id
      order by max(acquired_at) desc, card_id
      limit ${COLLECTION_PAGE + 1} offset ${page * COLLECTION_PAGE}`)
    return {
      rows: rows.slice(0, COLLECTION_PAGE).map((r) => ({ cardId: r.card_id, count: r.n, test: r.test, listed: r.listed, newest: new Date(r.newest) })),
      more: rows.length > COLLECTION_PAGE,
    }
  }

  async summary(userId: string) {
    const { rows } = await this.db.execute<{ card_id: string; n: number; real: number }>(sql`
      select card_id, count(*)::int as n, (count(*) filter (where source <> 'test'))::int as real
      from account.owned_cards where user_id = ${userId} group by card_id`)
    return summarize(rows.map((r) => ({ cardId: r.card_id, count: r.n, real: r.real })))
  }

  async addTestCards(userId: string, cardId: string, count: number) {
    await this.db.execute(sql`
      insert into account.owned_cards (user_id, card_id, source)
      select ${userId}, ${cardId}, 'test' from generate_series(1, ${count})`)
  }

  async packCheck(userId: string): Promise<PackCheck> {
    // Per pack: the sorted cards[] against the sorted ids of the copies made with it
    const { rows } = await this.db.execute<{ mine_packs: number; mine_bad: number; all_packs: number; all_bad: number }>(sql`
      with checked as (
        select p.user_id,
               (select array_agg(c order by c) from unnest(p.cards) c) is distinct from
               (select array_agg(o.card_id order by o.card_id) from account.owned_cards o where o.pack_id = p.id) as bad
        from account.pack_openings p
      )
      select (count(*) filter (where user_id = ${userId}))::int as mine_packs,
             (count(*) filter (where user_id = ${userId} and bad))::int as mine_bad,
             count(*)::int as all_packs,
             (count(*) filter (where bad))::int as all_bad
      from checked`)
    const r = rows[0]!
    return { mine: { packs: r.mine_packs, mismatched: r.mine_bad }, all: { packs: r.all_packs, mismatched: r.all_bad } }
  }
}

/** Totals and per-set progress (distinct real cards over what the set's packs can give) */
export function summarize(rows: { cardId: string; count: number; real: number }[]): CollectionSummary {
  return {
    cards: rows.reduce((n, r) => n + r.count, 0),
    distinct: rows.length,
    sets: PACK_SETS.map((s) => {
      const ids = new Set(Object.values(s.tiers).flat())
      return { id: s.id, owned: rows.filter((r) => r.real > 0 && ids.has(r.cardId)).length, total: ids.size }
    }),
    owned: rows.filter((r) => r.real > 0).map((r) => ({ cardId: r.cardId, count: r.real })).sort((a, b) => a.cardId.localeCompare(b.cardId)),
  }
}

/**
 * The exchange function's grants, checked at start-up with the table lists (Security X-1, X-2): api_rw may
 * EXECUTE it; nobody else may, PUBLIC included; its owner can't log in and can only read/delete owned_cards and
 * read auctions. Returns what's missing (refuse to start) and what's wider than it should be (warn).
 */
export async function exchangeFunctionCheck(db: Pick<NodePgDatabase, 'execute'>, role: string | null = null): Promise<{ missing: string[]; excess: string[] }> {
  const fn = 'account.exchange_cards(uuid,text,integer)'
  // The app checks itself (current_user); a dev script running as the owner names api_rw instead
  const canExecute = role ? sql`has_function_privilege(${role}, ${fn}, 'EXECUTE')` : sql`has_function_privilege(${fn}, 'EXECUTE')`
  const { rows } = await db.execute<Record<string, boolean | null>>(sql`
    select
      to_regprocedure(${fn}) is not null as exists,
      ${canExecute} as api_rw_execute,
      (select p.prosecdef and pg_get_userbyid(p.proowner) = 'card_exchanger'
              and p.proconfig @> array['search_path=pg_catalog, pg_temp']
         from pg_catalog.pg_proc p where p.oid = to_regprocedure(${fn})) as definer_ok,
      (select p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         from pg_catalog.pg_proc p where p.oid = to_regprocedure(${fn})) as public_execute,
      exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'collector_rw')
        and has_function_privilege('collector_rw', ${fn}, 'EXECUTE') as collector_execute,
      exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'app_rw')
        and has_function_privilege('app_rw', ${fn}, 'EXECUTE') as app_execute,
      (select r.rolcanlogin from pg_catalog.pg_roles r where r.rolname = 'card_exchanger') as owner_login,
      has_table_privilege('card_exchanger', 'account.owned_cards', 'INSERT,UPDATE,TRUNCATE') as owner_owned_write,
      has_table_privilege('card_exchanger', 'account.point_entries', 'SELECT,INSERT,UPDATE,DELETE') as owner_points,
      has_table_privilege('card_exchanger', 'account.users', 'SELECT,INSERT,UPDATE,DELETE') as owner_users,
      -- The app's roles never become the owner role (Security I-x2)
      exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'api_rw') and pg_has_role('api_rw', 'card_exchanger', 'MEMBER') as api_member,
      exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'collector_rw') and pg_has_role('collector_rw', 'card_exchanger', 'MEMBER') as collector_member`)
  const r = rows[0] ?? {}
  const missing = [
    ...(r.exists !== true ? ['FUNCTION account.exchange_cards'] : []),
    ...(r.exists === true && r.api_rw_execute !== true ? ['EXECUTE account.exchange_cards'] : []),
    ...(r.exists === true && r.definer_ok !== true ? ['account.exchange_cards: SECURITY DEFINER, owner card_exchanger, fixed search_path'] : []),
  ]
  const excess = [
    ...(r.public_execute === true ? ['EXECUTE account.exchange_cards for PUBLIC'] : []),
    ...(r.collector_execute === true ? ['EXECUTE account.exchange_cards for collector_rw'] : []),
    ...(r.app_execute === true ? ['EXECUTE account.exchange_cards for app_rw'] : []),
    ...(r.owner_login === true ? ['card_exchanger can log in'] : []),
    ...(r.owner_owned_write === true ? ['card_exchanger INSERT/UPDATE/TRUNCATE on owned_cards'] : []),
    ...(r.owner_points === true ? ['card_exchanger on point_entries'] : []),
    ...(r.owner_users === true ? ['card_exchanger on users'] : []),
    ...(r.api_member === true ? ['api_rw is a member of card_exchanger'] : []),
    ...(r.collector_member === true ? ['collector_rw is a member of card_exchanger'] : []),
  ]
  return { missing, excess }
}
