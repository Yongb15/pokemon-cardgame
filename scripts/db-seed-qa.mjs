// Resets the qa test cards on the **dev** database branch to fixed price histories (docs/price/design.md,
// qa list E). Dates are relative to today (UTC), so the data never goes out of range.
//
//   SEED_CONFIRM=dev node --env-file=.env scripts/db-seed-qa.mjs            reset all test cards
//   SEED_CONFIRM=dev node --env-file=.env scripts/db-seed-qa.mjs --stale sv6-1
//       make one card due for a refresh (refreshed 25 hours ago), to test refresh-on-view
//
// Runs as the owner (DATABASE_URL_OWNER) because it also writes the Japanese link table.
// Test cards are marked refreshed far in the future so they don't refresh while qa tests.

import { neon } from '@neondatabase/serverless'

if (process.env.SEED_CONFIRM !== 'dev') throw new Error('Set SEED_CONFIRM=dev: this rewrites test data (dev branch only)')
const sql = neon(process.env.DATABASE_URL_OWNER ?? '')

// The flag alone can't tell which branch the URL points to (Security P-1): only the dev branch
// has this marker table (made by hand there, never by a migration)
const [{ marker }] = await sql`select to_regclass('public.dev_marker') is not null as marker`
if (!marker) throw new Error('This database has no dev_marker table: refusing to seed (not the dev branch)')

const DAY = 86_400_000
const today = new Date(new Date().toISOString().slice(0, 10))
const day = (offset) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10)
const FUTURE = '2099-01-01T00:00:00Z'

const staleIndex = process.argv.indexOf('--stale')
if (staleIndex !== -1) {
  const id = process.argv[staleIndex + 1]
  if (!id) throw new Error('--stale needs a card id')
  const rows = await sql`update price_refresh set refreshed_at = now() - interval '25 hours', status = 'ok'
    where card_id = ${id} returning card_id`
  console.log(rows.length ? `${id}: refresh due now` : `${id}: not a seeded card`)
  process.exit(0)
}

/** A level from `from` to `to` (offsets from today), oldest first */
const level = (from, to, market, extra = {}) => ({ from, to, market, ...extra })

// card id → [{ edition, source, variant, currency, levels }]
const histories = {
  // 1. Both sources, long history with small moves
  'sv6-25': [
    { edition: 'en', source: 'tcgplayer', variant: 'holo', currency: 'USD', levels: [level(-100, -61, 4.2), level(-60, -31, 3.6), level(-30, -8, 3.2), level(-7, 0, 3.05)] },
    { edition: 'en', source: 'cardmarket', variant: 'holo', currency: 'EUR', levels: [level(-100, -41, 3.5), level(-40, 0, 2.9)] },
  ],
  // 2. Normal and reverse holo
  'sv6-1': [
    { edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-40, 0, 0.12)] },
    { edition: 'en', source: 'tcgplayer', variant: 'reverse', currency: 'USD', levels: [level(-40, 0, 0.35)] },
  ],
  // 3. basep-1: no price at all (only a not_found refresh row below)
  // 4. Cardmarket only
  'sv3pt5-1': [{ edition: 'en', source: 'cardmarket', variant: 'normal', currency: 'EUR', levels: [level(-20, 0, 0.4)] }],
  // 5a. A one-day 10× spike that went back
  'sv2-1': [
    {
      edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD',
      levels: [level(-30, -11, 0.2), level(-10, -10, 2.5, { flagged: true }), level(-9, 0, 0.21)],
    },
  ],
  // 5b. A real jump that stayed: flagged at first, accepted on the 3rd day
  'sv2-2': [
    { edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-30, -6, 0.3), level(-5, 0, 3.6)] },
  ],
  // 6a. A single point
  'sv4-1': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(0, 0, 0.15)] }],
  // 6b. A gap of failed days (last seen -12, next level from -5)
  'sv4-2': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-30, -12, 0.5), level(-5, 0, 0.55)] }],
  // 7. The last change is before the 30-day range (qa D-4)
  'sv5-1': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-45, 0, 0.25)] }],
  // 8a. Japanese print linked, with a Japanese price
  'sv3pt5-6': [
    { edition: 'en', source: 'tcgplayer', variant: 'holo', currency: 'USD', levels: [level(-30, 0, 6.5)] },
    { edition: 'ja', source: 'cardmarket', variant: 'holo', currency: 'EUR', levels: [level(-30, 0, 4.1)] },
  ],
  // 8b. Linked, no Japanese price
  'sv3pt5-25': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-30, 0, 0.3)] }],
  // 9a. Very cheap (under ₩100)
  'sv6-2': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-30, 0, 0.05)] }],
  // 9b. Very expensive (over ₩1,000,000)
  'sv3pt5-199': [{ edition: 'en', source: 'tcgplayer', variant: 'holo', currency: 'USD', levels: [level(-60, 0, 920)] }],
  // 10. Stale: the last value is 10 days old and the latest refresh failed
  'sv6-3': [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(-40, -10, 0.18)] }],
  // 11. Captured on a weekend (a Saturday 1–7 days ago), rates exist only on weekdays
  'sv6-4': [],
}

// 11: the most recent Saturday before today
const saturday = (() => {
  for (let i = 1; i <= 7; i++) if (new Date(today.getTime() - i * DAY).getUTCDay() === 6) return -i
})()
histories['sv6-4'] = [{ edition: 'en', source: 'tcgplayer', variant: 'normal', currency: 'USD', levels: [level(saturday, saturday, 0.2)] }]

const links = [
  { cardId: 'sv3pt5-6', externalId: 'SV2a-006', method: 'manual', confidence: 1, verified: true }, // 8a
  { cardId: 'sv3pt5-25', externalId: 'SV2a-025', method: 'manual', confidence: 1, verified: true }, // 8b
  // 8c. sv3pt5-1: no link row yet ("연결 정보가 아직 없어요")
  { cardId: 'swsh12tg-TG01', externalId: '', method: 'none', confidence: 1, verified: true }, // 8d. English-only
]

const allIds = [...new Set([...Object.keys(histories), 'basep-1', 'swsh12tg-TG01', 'sve-1'])]

await sql`delete from price_snapshot where card_id = any(${allIds})`
await sql`delete from price_refresh where card_id = any(${allIds})`
await sql`delete from card_edition_link where card_id = any(${allIds})`

let rows = 0
for (const [cardId, series] of Object.entries(histories)) {
  for (const s of series) {
    for (const l of s.levels) {
      await sql`insert into price_snapshot
        (card_id, edition, source, variant, captured_on, last_seen_on, currency, market, flagged)
        values (${cardId}, ${s.edition}, ${s.source}, ${s.variant}, ${day(l.from)}, ${day(l.to)}, ${s.currency}, ${l.market}, ${l.flagged ?? false})`
      rows++
    }
  }
}
for (const id of allIds) {
  const status = id === 'basep-1' ? 'not_found' : id === 'sv6-3' ? 'error' : 'ok'
  await sql`insert into price_refresh (card_id, refreshed_at, status) values (${id}, ${FUTURE}, ${status})`
}
for (const l of links) {
  await sql`insert into card_edition_link (card_id, edition, external_id, method, confidence, verified)
    values (${l.cardId}, 'ja', ${l.externalId}, ${l.method}, ${l.confidence}, ${l.verified})`
}

// Weekday-only rates for the last 100 days (no weekend rows: qa D-1)
for (let i = -100; i <= 0; i++) {
  const d = new Date(today.getTime() + i * DAY)
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
  for (const [currency, base] of [['USD', 1338], ['EUR', 1497], ['JPY', 8.46]]) {
    const rate = base * (1 + Math.sin(i / 9) * 0.01)
    await sql`insert into fx_rate (currency, rate_date, krw_per_unit, usable) values (${currency}, ${day(i)}, ${rate}, true)
      on conflict (currency, rate_date) do update set krw_per_unit = excluded.krw_per_unit, usable = true`
  }
}

console.log(`Seeded ${allIds.length} test cards, ${rows} price levels, ${links.length} links, weekday rates for 100 days`)
