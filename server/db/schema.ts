// Database schema (Neon PostgreSQL, Drizzle). Cards themselves stay in the built JSON under data/;
// the database only keeps prices and what's needed to fetch them. See docs/price/design.md.
//
// Allowed values are also CHECK constraints, so nothing outside these lists can become part of
// a primary key (Security review: an outside string in the key would grow rows without limit).

import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const EDITIONS = ['en', 'ja', 'ko'] as const
export const SOURCES = ['tcgplayer', 'cardmarket'] as const
export const VARIANTS = ['normal', 'holo', 'reverse', 'firstEdition', 'unlimited'] as const
export const CURRENCIES = ['USD', 'EUR', 'JPY'] as const
export const REFRESH_STATUSES = ['pending', 'ok', 'not_found', 'error'] as const

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`)

/**
 * One row per price level: a new row only when the value changes. `last_seen_on` is the last day
 * the same value was confirmed, so a gap before the next row means refreshes failed (qa D-4).
 * Dates are UTC days (qa D-2).
 */
export const priceSnapshot = pgTable(
  'price_snapshot',
  {
    cardId: text('card_id').notNull(),
    edition: text('edition').notNull(),
    source: text('source').notNull(),
    variant: text('variant').notNull(),
    capturedOn: date('captured_on').notNull(),
    lastSeenOn: date('last_seen_on').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** The headline value: TCGplayer market price / Cardmarket trend price */
    market: numeric('market', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    low: numeric('low', { precision: 12, scale: 2, mode: 'number' }),
    avg30: numeric('avg30', { precision: 12, scale: 2, mode: 'number' }),
    /** An outlier against the recent median: kept, but left out of the headline and the chart (qa D-5) */
    flagged: boolean('flagged').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.edition, t.source, t.variant, t.capturedOn] }),
    index('price_snapshot_card_idx').on(t.cardId, t.edition, t.capturedOn),
    check('price_snapshot_edition_check', oneOf('edition', EDITIONS)),
    check('price_snapshot_source_check', oneOf('source', SOURCES)),
    check('price_snapshot_variant_check', oneOf('variant', VARIANTS)),
    check('price_snapshot_currency_check', oneOf('currency', CURRENCIES)),
    check('price_snapshot_values_check', sql`market >= 0 and market <= 100000 and (low is null or low >= 0)`),
    check('price_snapshot_seen_check', sql`last_seen_on >= captured_on`),
  ],
)

/** When a card's prices were last fetched; claimed atomically so one request fetches per day */
export const priceRefresh = pgTable(
  'price_refresh',
  {
    cardId: text('card_id').primaryKey(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
  },
  () => [check('price_refresh_status_check', oneOf('status', REFRESH_STATUSES))],
)

/** KRW per unit of a currency, one row per UTC day with a rate (none on weekends: qa D-1) */
export const fxRate = pgTable(
  'fx_rate',
  {
    currency: char('currency', { length: 3 }).notNull(),
    rateDate: date('rate_date').notNull(),
    krwPerUnit: numeric('krw_per_unit', { precision: 14, scale: 6, mode: 'number' }).notNull(),
    /** False when the rate jumped more than 20% from the last good one: stored, not used */
    usable: boolean('usable').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.rateDate] }),
    check('fx_rate_currency_check', oneOf('currency', CURRENCIES)),
    check('fx_rate_positive_check', sql`krw_per_unit > 0`),
  ],
)

/** The Japanese print that stands for an English card (one per card), checked by qa */
export const cardEditionLink = pgTable(
  'card_edition_link',
  {
    cardId: text('card_id').notNull(),
    edition: text('edition').notNull(),
    externalId: text('external_id').notNull(),
    method: text('method').notNull(),
    confidence: real('confidence').notNull(),
    verified: boolean('verified').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.edition] }),
    check('card_edition_link_edition_check', sql`edition = 'ja'`),
    // 'none': checked, and there is no Japanese print (an English-only card such as a Trainer Gallery card)
    check('card_edition_link_method_check', sql`method in ('auto', 'manual', 'none')`),
  ],
)

/** Detail-page price views per card and UTC day, for refresh priority. No user data. */
export const cardViewDaily = pgTable(
  'card_view_daily',
  {
    cardId: text('card_id').notNull(),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.day] })],
)

/** Counters per UTC day: the refresh-on-view budget, and where the daily cron run left off */
export const dailyCounter = pgTable(
  'daily_counter',
  {
    name: text('name').notNull(),
    day: date('day').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.name, t.day] })],
)
