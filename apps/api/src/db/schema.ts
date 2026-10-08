// User data lives in its own schema `account`, used only by the API server's role `api_rw`. The price
// functions' role `app_rw` gets nothing here, and `api_rw` nothing in `public` (Security: separate
// schemas so neither role can touch the other's tables). See docs/auth/design.md.
//
// Migrations come from drizzle-kit like the price tables (drizzle.config.ts lists this file too).

import { sql } from 'drizzle-orm'
import { check, customType, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
