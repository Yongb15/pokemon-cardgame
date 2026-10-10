// Card packs and the collection (docs/auction/packs.md). Opening a pack is one transaction, in the
// lock order every points change keeps (Security K-2): the user's point account first, then the
// writes. A request id (idem_key) makes a retry return the pack it already opened — even with a
// different set — without charging again.

import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { credit, lockAccount } from '../points/store.js'
import { drawPack, PACK_PRICE, PACK_SETS, packSet, type DrawnCard, type Rng, type Tier } from './odds.js'

export const COLLECTION_PAGE = 60

export const PACKS_PRIVILEGES: [string, string | null, string][] = [
  ['pack_openings', null, 'SELECT'],
  ['pack_openings', 'user_id', 'INSERT'],
  ['pack_openings', 'set_id', 'INSERT'],
  ['pack_openings', 'cost', 'INSERT'],
  ['pack_openings', 'cards', 'INSERT'],
  ['pack_openings', 'seeded', 'INSERT'],
  ['pack_openings', 'idem_key', 'INSERT'],
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

export type OpenResult = { kind: 'opened' | 'repeat'; pack: OpenedPack } | { kind: 'insufficient'; available: number }

export interface CollectionRow {
  cardId: string
  count: number
  /** Copies from the preview test hook (not counted towards set progress) */
  test: number
  newest: Date
}

export interface CollectionSummary {
  cards: number
  distinct: number
  /** Per pack set: distinct cards owned (test copies excluded) out of what its packs can give */
  sets: { id: string; owned: number; total: number }[]
}

export interface PackCheck {
  /** My packs whose cards[] differ from the copies inserted with that pack id */
  mine: { packs: number; mismatched: number }
  all: { packs: number; mismatched: number }
}

export interface PacksStore {
  /** The pack a request id already opened (no lock: a hint before the rate limit; open() decides) */
  prior(userId: string, idemKey: string): Promise<OpenedPack | null>
  open(userId: string, setId: string, idemKey: string, rng?: Rng, seeded?: boolean): Promise<OpenResult>
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

  async open(userId: string, setId: string, idemKey: string, rng?: Rng, seeded = false): Promise<OpenResult> {
    const set = packSet(setId)
    if (!set) throw new Error('unknown set')
    return this.db.transaction(async (tx) => {
      const account = await lockAccount(tx, userId)
      // A retry of a request we already served: the same pack, no second charge (K-2)
      const prior = await tx.execute<{ id: string; set_id: string; cards: string[]; created_at: Date }>(
        sql`select id, set_id, cards, created_at from account.pack_openings where user_id = ${userId} and idem_key = ${idemKey}`,
      )
      if (prior.rows[0]) {
        const p = prior.rows[0]
        return { kind: 'repeat', pack: { id: p.id, setId: p.set_id, cards: asPackCards(p.set_id, p.cards, null), createdAt: new Date(p.created_at) } }
      }
      if (account.balance - account.held < PACK_PRICE) return { kind: 'insufficient', available: account.balance - account.held }

      const drawn = drawPack(set, rng)
      const ids = drawn.map((c) => c.cardId)
      // One JSON parameter: drizzle would spread a JS array into separate ones
      const idsJson = JSON.stringify(ids)
      const owned = await tx.execute<{ card_id: string }>(
        sql`select distinct card_id from account.owned_cards where user_id = ${userId} and card_id in (select json_array_elements_text(${idsJson}::json))`,
      )
      const before = new Set(owned.rows.map((r) => r.card_id))
      const inserted = await tx.execute<{ id: string; created_at: Date }>(sql`
        insert into account.pack_openings (user_id, set_id, cost, cards, seeded, idem_key)
        values (${userId}, ${setId}, ${PACK_PRICE}, array(select json_array_elements_text(${idsJson}::json)), ${seeded}, ${idemKey})
        returning id, created_at`)
      const pack = inserted.rows[0]!
      const charged = await credit(tx, userId, account, -PACK_PRICE, 'pack_purchase', pack.id, `pack:${idemKey}`)
      if (charged !== 'ok') throw new Error(`pack charge ${charged}`) // rolls everything back
      await tx.execute(sql`
        insert into account.owned_cards (user_id, card_id, source, pack_id)
        select ${userId}, card_id, 'pack', ${pack.id}::uuid from json_array_elements_text(${idsJson}::json) as card_id`)
      const cards = drawn.map((c) => ({ ...c, isNew: !before.has(c.cardId) }))
      // A card drawn twice in one pack is new only the first time
      const seen = new Set<string>()
      for (const c of cards) {
        if (seen.has(c.cardId)) c.isNew = false
        seen.add(c.cardId)
      }
      return { kind: 'opened', pack: { id: pack.id, setId, cards, createdAt: new Date(pack.created_at) } }
    })
  }

  async prior(userId: string, idemKey: string) {
    const { rows } = await this.db.execute<{ id: string; set_id: string; cards: string[]; created_at: Date }>(
      sql`select id, set_id, cards, created_at from account.pack_openings where user_id = ${userId} and idem_key = ${idemKey}`,
    )
    const p = rows[0]
    return p ? { id: p.id, setId: p.set_id, cards: asPackCards(p.set_id, p.cards, null), createdAt: new Date(p.created_at) } : null
  }

  async latest(userId: string) {
    const { rows } = await this.db.execute<{ id: string; set_id: string; cards: string[]; created_at: Date }>(
      sql`select id, set_id, cards, created_at from account.pack_openings where user_id = ${userId} order by created_at desc limit 1`,
    )
    const p = rows[0]
    return p ? { id: p.id, setId: p.set_id, cards: asPackCards(p.set_id, p.cards, null), createdAt: new Date(p.created_at) } : null
  }

  async collection(userId: string, setId: string | null, page: number) {
    const { rows } = await this.db.execute<{ card_id: string; n: number; test: number; newest: Date }>(sql`
      select card_id, count(*)::int as n, (count(*) filter (where source = 'test'))::int as test, max(acquired_at) as newest
      from account.owned_cards
      where user_id = ${userId} ${setId ? sql`and starts_with(card_id, ${setPrefix(setId)})` : sql``}
      group by card_id
      order by max(acquired_at) desc, card_id
      limit ${COLLECTION_PAGE + 1} offset ${page * COLLECTION_PAGE}`)
    return {
      rows: rows.slice(0, COLLECTION_PAGE).map((r) => ({ cardId: r.card_id, count: r.n, test: r.test, newest: new Date(r.newest) })),
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
  }
}
