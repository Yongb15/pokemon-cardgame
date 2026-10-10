// Price storage on Neon (as the least-privilege role app_rw). Every query binds its values.
// Errors are thrown as a plain DbError with no query, parameters or connection details in it.

import { neon } from '@neondatabase/serverless'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { drizzle } from 'drizzle-orm/neon-http'
import { cardEditionLink, dailyCounter, fxRate, priceRefresh, priceSnapshot } from '../db/schema.js'
import { daysBetween, decideOutlier, isSameLevel, isUsableRate, type Currency, type LevelRow } from './logic.js'
import type { FxResult, PriceRow } from './sources.js'

export class DbError extends Error {
  /** The SQLSTATE code only (e.g. "57014" statement timeout, "53300" too many connections): no detail */
  code: string | null = null
}

let db: ReturnType<typeof drizzle> | null = null
function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new DbError('database not configured')
    db = drizzle({ client: neon(url) })
  }
  return db
}

/** Runs a query; anything that goes wrong becomes a DbError without details (Security) */
async function run<T>(query: (d: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  try {
    return await query(getDb())
  } catch (error) {
    if (error instanceof DbError) throw error
    const wrapped = new DbError('database error')
    // Drizzle may wrap the driver's error: the code can be one level down
    const e = error as { code?: unknown; cause?: { code?: unknown } } | null
    const code = e?.code ?? e?.cause?.code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) wrapped.code = code
    throw wrapped
  }
}

const rowsOf = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[]

/**
 * Claims today's refresh of a card: only the request that gets `true` fetches. A failed or timed
 * out fetch keeps the claim, so errors can't be retried into many outside requests (Security).
 */
export async function claimRefresh(cardId: string, afterHours = 24): Promise<boolean> {
  // A daily job that starts a little earlier each day uses a shorter gap (the collector: 20 h)
  const hours = Math.max(1, Math.min(24, Math.floor(afterHours)))
  const result = await run((d) =>
    d.execute(sql`
      insert into price_refresh (card_id, refreshed_at, status) values (${cardId}, now(), 'pending')
      on conflict (card_id) do update set refreshed_at = now(), status = 'pending'
      where price_refresh.refreshed_at < now() - make_interval(hours => ${hours})
      returning card_id`),
  )
  return rowsOf(result).length === 1
}

export async function setRefreshStatus(cardId: string, status: 'ok' | 'not_found' | 'error') {
  await run((d) => d.update(priceRefresh).set({ status }).where(eq(priceRefresh.cardId, cardId)))
}

/** Whether a daily budget has units left, without taking one (no write once it's used up) */
export async function budgetLeft(name: string, day: string, limit: number): Promise<boolean> {
  const [row] = await run((d) =>
    d.select({ value: dailyCounter.value }).from(dailyCounter).where(and(eq(dailyCounter.name, name), eq(dailyCounter.day, day))),
  )
  return (row?.value ?? 0) < limit
}

/** Takes one unit of a daily budget; false once `limit` is used up */
export async function takeBudget(name: string, day: string, limit: number): Promise<boolean> {
  const result = await run((d) =>
    d.execute(sql`
      insert into daily_counter (name, day, value) values (${name}, ${day}, 1)
      on conflict (name, day) do update set value = daily_counter.value + 1
      where daily_counter.value < ${limit}
      returning value`),
  )
  return rowsOf(result).length === 1
}

export async function recordView(cardId: string, day: string) {
  await run((d) =>
    d.execute(sql`
      insert into card_view_daily (card_id, day, views) values (${cardId}, ${day}, 1)
      on conflict (card_id, day) do update set views = card_view_daily.views + 1`),
  )
}

/** Card ids whose last refresh is at least 24 hours old, plus when (oldest first) */
export async function refreshTimes(cardIds: string[]) {
  const times = new Map<string, Date>()
  // In chunks: the collector asks about every card at once
  for (let i = 0; i < cardIds.length; i += 2000) {
    const chunk = cardIds.slice(i, i + 2000)
    const rows = await run((d) =>
      d
        .select({ cardId: priceRefresh.cardId, refreshedAt: priceRefresh.refreshedAt })
        .from(priceRefresh)
        .where(inArray(priceRefresh.cardId, chunk)),
    )
    for (const r of rows) times.set(r.cardId, r.refreshedAt)
  }
  return times
}

/** The most viewed cards over the last `days` days */
export async function topViewed(sinceDay: string, limit: number): Promise<string[]> {
  const result = await run((d) =>
    d.execute(sql`
      select card_id from card_view_daily where day >= ${sinceDay}
      group by card_id order by sum(views) desc limit ${limit}`),
  )
  return rowsOf(result).map((r) => String(r.card_id))
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Stores today's prices for one card and edition. Only changes add a row: the same value just moves
 * `last_seen_on` forward (qa D-4). Outliers are flagged against the recent median and accepted after
 * three days at the new level (qa D-5). Returns how many levels changed.
 */
export async function savePrices(cardId: string, edition: 'en' | 'ja', rows: PriceRow[], today: string) {
  // Read everything first, then write all of it in one transaction, so a reader never sees some
  // variants new and some old (qa P3-3)
  const keyOf = (row: PriceRow) =>
    and(
      eq(priceSnapshot.cardId, cardId),
      eq(priceSnapshot.edition, edition),
      eq(priceSnapshot.source, row.source),
      eq(priceSnapshot.variant, row.variant),
    )
  const recents = await Promise.all(
    rows.map(async (row) =>
      (
        await run((d) =>
          d
            .select({
              capturedOn: priceSnapshot.capturedOn,
              lastSeenOn: priceSnapshot.lastSeenOn,
              market: priceSnapshot.market,
              flagged: priceSnapshot.flagged,
            })
            .from(priceSnapshot)
            .where(keyOf(row))
            .orderBy(desc(priceSnapshot.capturedOn))
            .limit(30),
        )
      ).reverse(),
    ),
  )

  const d = getDb()
  const writes: BatchItem<'pg'>[] = []
  let changed = 0
  rows.forEach((row, i) => {
    const value = round2(row.market)
    const key = keyOf(row)
    const recent = recents[i]

    // A second run on the same day replaces today's row
    const last = recent.at(-1)
    const history = last?.capturedOn === today ? recent.slice(0, -1) : recent
    const levels: LevelRow[] = history.map((r) => ({
      market: r.market,
      flagged: r.flagged,
      days: daysBetween(r.capturedOn, r.lastSeenOn) + 1,
    }))
    const decision = decideOutlier(levels, value)
    const flagged = decision.flagged
    const previous = history.at(-1)

    // The outlier check comes first: a flagged price never merges into a normal level (or back)
    if (previous && previous.flagged === flagged && isSameLevel(previous.market, value) && last?.capturedOn !== today) {
      // Same level again (within 1%): extend it
      writes.push(
        // The 30-day average moves even when the price holds: keep the latest
        d
          .update(priceSnapshot)
          .set({ lastSeenOn: today, avg30: row.avg30 === null ? null : round2(row.avg30) })
          .where(and(key, eq(priceSnapshot.capturedOn, previous.capturedOn))),
      )
    } else {
      writes.push(
        d
          .insert(priceSnapshot)
          .values({
            cardId,
            edition,
            source: row.source,
            variant: row.variant,
            capturedOn: today,
            lastSeenOn: today,
            currency: row.currency,
            market: value,
            low: row.low === null ? null : round2(row.low),
            avg30: row.avg30 === null ? null : round2(row.avg30),
            flagged,
          })
          .onConflictDoUpdate({
            target: [priceSnapshot.cardId, priceSnapshot.edition, priceSnapshot.source, priceSnapshot.variant, priceSnapshot.capturedOn],
            set: {
              market: value,
              low: row.low === null ? null : round2(row.low),
              avg30: row.avg30 === null ? null : round2(row.avg30),
              flagged,
              lastSeenOn: today,
            },
          }),
      )
      changed++
    }

    // The new level held for three days: its earlier flagged rows become normal too
    if (!decision.flagged && decision.acceptRun > 0) {
      const runDays = history.slice(-decision.acceptRun).map((r) => r.capturedOn)
      writes.push(d.update(priceSnapshot).set({ flagged: false }).where(and(key, inArray(priceSnapshot.capturedOn, runDays))))
    }
  })
  if (writes.length) await run((db) => db.batch(writes as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]))
  return changed
}

/** Stores the day's rates; one more than 20% away from the last usable rate is kept but not used */
export async function saveFx(fx: FxResult) {
  for (const [currency, krw] of Object.entries(fx.rates) as [Currency, number][]) {
    const [lastGood] = await run((d) =>
      d
        .select({ krw: fxRate.krwPerUnit })
        .from(fxRate)
        .where(and(eq(fxRate.currency, currency), eq(fxRate.usable, true), sql`${fxRate.rateDate} < ${fx.rateDate}`))
        .orderBy(desc(fxRate.rateDate))
        .limit(1),
    )
    const usable = isUsableRate(lastGood?.krw ?? null, krw)
    await run((d) =>
      d
        .insert(fxRate)
        .values({ currency, rateDate: fx.rateDate, krwPerUnit: krw, usable })
        .onConflictDoUpdate({ target: [fxRate.currency, fxRate.rateDate], set: { krwPerUnit: krw, usable } }),
    )
  }
}

/** The Japanese print linked to an English card, if any (written by the owner from qa's review) */
export async function getEditionLink(cardId: string) {
  const [link] = await run((d) =>
    d
      .select({
        externalId: cardEditionLink.externalId,
        method: cardEditionLink.method,
        confidence: cardEditionLink.confidence,
        verified: cardEditionLink.verified,
      })
      .from(cardEditionLink)
      .where(and(eq(cardEditionLink.cardId, cardId), eq(cardEditionLink.edition, 'ja'))),
  )
  return link ?? null
}

/** Everything stored for one card (a few hundred rows at most: only changes are kept) */
export async function getPriceRows(cardId: string) {
  return run((d) =>
    d
      .select({
        edition: priceSnapshot.edition,
        source: priceSnapshot.source,
        variant: priceSnapshot.variant,
        currency: priceSnapshot.currency,
        capturedOn: priceSnapshot.capturedOn,
        lastSeenOn: priceSnapshot.lastSeenOn,
        market: priceSnapshot.market,
        avg30: priceSnapshot.avg30,
        flagged: priceSnapshot.flagged,
      })
      .from(priceSnapshot)
      .where(eq(priceSnapshot.cardId, cardId))
      .orderBy(priceSnapshot.capturedOn)
      .limit(1000),
  )
}

/** Rates from `sinceDay` on (start a few days early so weekends at the start have a rate) */
export async function getFxRates(sinceDay: string) {
  return run((d) =>
    d
      .select({ currency: fxRate.currency, rateDate: fxRate.rateDate, krwPerUnit: fxRate.krwPerUnit, usable: fxRate.usable })
      .from(fxRate)
      .where(sql`${fxRate.rateDate} >= ${sinceDay}`),
  )
}

export async function getRefresh(cardId: string) {
  const [row] = await run((d) =>
    d
      .select({ refreshedAt: priceRefresh.refreshedAt, status: priceRefresh.status })
      .from(priceRefresh)
      .where(eq(priceRefresh.cardId, cardId)),
  )
  return row ?? null
}

/**
 * Every card's latest unflagged level per source and print in one edition, confirmed on or after
 * `sinceDay`: what the price ranking ranks (one row per card × source × variant)
 */
export async function getLatestLevels(edition: 'en' | 'ja', sinceDay: string) {
  const result = await run((d) =>
    d.execute(sql`
      select distinct on (card_id, source, variant) card_id, source, variant, currency, market, last_seen_on
      from ${priceSnapshot}
      where edition = ${edition} and flagged = false and last_seen_on >= ${sinceDay}
      order by card_id, source, variant, captured_on desc`),
  )
  return rowsOf(result).map((r) => ({
    cardId: String(r.card_id),
    source: String(r.source),
    variant: String(r.variant),
    currency: String(r.currency),
    market: Number(r.market),
    lastSeenOn: String(r.last_seen_on).slice(0, 10),
  }))
}
