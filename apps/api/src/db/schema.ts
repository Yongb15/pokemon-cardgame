// User data lives in its own schema `account`, used only by the API server's role `api_rw`. The price
// functions' role `app_rw` gets nothing here, and `api_rw` nothing in `public` (Security: separate
// schemas so neither role can touch the other's tables). See docs/auth/design.md.
//
// Migrations come from drizzle-kit like the price tables (drizzle.config.ts lists this file too).

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const account = pgSchema('account')

export const PROVIDERS = ['google', 'kakao', 'test'] as const
export type Provider = (typeof PROVIDERS)[number]

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const users = account.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Display only, cleaned like deck names (2–20 characters) */
    nickname: text('nickname').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('users_nickname_check', sql`char_length(nickname) between 2 and 20`)],
)

/** One row per sign-in method; the provider's `sub` is the only thing we keep from it */
export const oauthAccounts = account.table(
  'oauth_accounts',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    index('oauth_accounts_user_idx').on(t.userId),
    check('oauth_accounts_provider_check', sql`provider in ('google', 'kakao', 'test')`),
    check('oauth_accounts_subject_check', sql`char_length(subject) between 1 and 255`),
  ],
)

/**
 * Opaque sessions: the cookie holds a random token, the table only its SHA-256 (a leaked table
 * can't be replayed). `expires_at` slides (30 days), `created_at` caps it at 90 days (Security).
 */
export const sessions = account.table(
  'sessions',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId, t.createdAt),
    index('sessions_expires_idx').on(t.expiresAt),
    check('sessions_token_hash_check', sql`octet_length(token_hash) = 32`),
    check('sessions_expiry_check', sql`expires_at <= created_at + interval '90 days'`),
  ],
)

/**
 * Account decks. `cards` is [{ id, count }] checked by the API (packages/shared validCards) and,
 * as a backstop, the CHECKs here. `version` is the optimistic lock: a save names the version it
 * edited, and a save of an older one is refused (409). `source_id` is the browser deck's id for
 * imports: importing the same browser deck twice finds the first copy (qa I-2).
 */
export const decks = account.table(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: text('source_id'),
    name: text('name').notNull(),
    format: text('format').notNull(),
    cards: jsonb('cards').$type<{ id: string; count: number }[]>().notNull(),
    /** For the deck list, saved by the editor: the cover card and how many rules fail */
    coverId: text('cover_id'),
    problems: integer('problems'),
    version: integer('version').notNull().default(1),
    // clock_timestamp(), not now(): decks imported in one transaction keep their order (qa D5-2)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index('decks_user_idx').on(t.userId, t.updatedAt),
    uniqueIndex('decks_user_source_idx').on(t.userId, t.sourceId),
    check('decks_name_check', sql`char_length(name) between 1 and 50`),
    check('decks_format_check', sql`format in ('standard', 'expanded', 'unlimited')`),
    check('decks_cards_check', sql`jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 60`),
    check('decks_source_check', sql`source_id is null or source_id ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check('decks_version_check', sql`version >= 1`),
    check('decks_cover_check', sql`cover_id is null or cover_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'`),
    check('decks_problems_check', sql`problems is null or problems between 0 and 999`),
  ],
)

/** Hearted cards: just ids (the card data lives on the web side) */
export const favorites = account.table(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cardId] }),
    index('favorites_user_idx').on(t.userId, t.createdAt),
    check('favorites_card_check', sql`card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'`),
  ],
)

// --- M7 points (docs/auction/design.md §2, ADR 0005) ----------------------------------------------

export const POINT_KINDS = ['signup_bonus', 'daily_bonus', 'pack_purchase', 'sale_income', 'sale_fee', 'purchase', 'admin_adjust'] as const
export type PointKind = (typeof POINT_KINDS)[number]

/**
 * The points ledger: one row per change, never updated or deleted (api_rw has INSERT and SELECT
 * only). A user's balance is the sum of their rows; `idem_key` makes a retried request a no-op.
 */
export const pointEntries = account.table(
  'point_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    /** What it was for: an auction or pack id, or 'test' for a preview top-up */
    ref: text('ref'),
    idemKey: text('idem_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('point_entries_idem_idx').on(t.userId, t.idemKey),
    index('point_entries_user_idx').on(t.userId, t.createdAt),
    check('point_entries_amount_check', sql`amount <> 0 and amount between -100000000 and 100000000`),
    check('point_entries_kind_check', sql.raw(`kind in (${POINT_KINDS.map((k) => `'${k}'`).join(', ')})`)),
    check('point_entries_ref_check', sql`ref is null or ref ~ '^[A-Za-z0-9_:-]{1,64}$'`),
    check('point_entries_idem_check', sql`idem_key ~ '^[A-Za-z0-9_:-]{1,80}$'`),
  ],
)

/**
 * Each user's balance (the ledger's sum, kept in the same transaction) and what open bids hold.
 * Writers lock this row (FOR UPDATE); the CHECK makes a negative or over-held balance impossible
 * whatever the code does.
 */
export const pointAccounts = account.table(
  'point_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    held: bigint('held', { mode: 'number' }).notNull().default(0),
    version: integer('version').notNull().default(0),
  },
  () => [check('point_accounts_balance_check', sql`held >= 0 and balance >= held and balance <= 10000000000`)],
)

/** One check-in a day per user (the KST date) */
export const dailyClaims = account.table(
  'daily_claims',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)

// --- M7 card packs and collection (docs/auction/packs.md) ----------------------------------------

export const CARD_SOURCES = ['pack', 'auction', 'test'] as const

/**
 * One row per opened pack: the audit record (what it cost, the five cards it gave). Never updated:
 * when cards change hands in 7c, this still says what the pack produced (Security 7b (b)).
 */
export const packOpenings = account.table(
  'pack_openings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    setId: text('set_id').notNull(),
    cost: bigint('cost', { mode: 'number' }).notNull(),
    cards: text('cards').array().notNull(),
    /** Drawn with a test seed (preview only): left out of any odds statistics */
    seeded: boolean('seeded').notNull().default(false),
    idemKey: text('idem_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('pack_openings_idem_idx').on(t.userId, t.idemKey),
    index('pack_openings_user_idx').on(t.userId, t.createdAt),
    check('pack_openings_set_check', sql`set_id ~ '^[a-z0-9]{1,20}$'`),
    check('pack_openings_cost_check', sql`cost between 1 and 100000000`),
    check('pack_openings_cards_check', sql`cardinality(cards) = 5`),
    check('pack_openings_idem_check', sql`idem_key ~ '^[A-Za-z0-9_-]{8,64}$'`),
  ],
)

/** The virtual cards a user owns, one row per copy (the unit an auction sells in 7c) */
export const ownedCards = account.table(
  'owned_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    source: text('source').notNull(),
    packId: uuid('pack_id').references(() => packOpenings.id, { onDelete: 'set null' }),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index('owned_cards_user_idx').on(t.userId, t.acquiredAt),
    index('owned_cards_pack_idx').on(t.packId),
    check('owned_cards_card_check', sql`card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'`),
    check('owned_cards_source_check', sql.raw(`source in (${CARD_SOURCES.map((s) => `'${s}'`).join(', ')})`)),
  ],
)
