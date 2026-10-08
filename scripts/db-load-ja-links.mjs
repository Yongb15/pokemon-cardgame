// Loads data/ja-links.json (scripts/build-ja-links.mjs) into card_edition_link, as the owner (the
// app role can only read this table). Automatic matches never replace a link qa checked
// (method 'manual' or 'none', or verified).
//
//   node --env-file=.env scripts/db-load-ja-links.mjs                 dev branch (DATABASE_URL_OWNER)
//   node --env-file=.env scripts/db-load-ja-links.mjs data/ja-verified.tsv
//       also mark qa-checked links: TSV with en_id, ja_id, verdict (ok | wrong | none)

import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL_OWNER ?? '')
const links = JSON.parse(await readFile(new URL('../data/ja-links.json', import.meta.url), 'utf8'))
const ID = /^[\w.!?-]{1,40}$/

let written = 0
for (const { cardId, externalId, confidence } of links) {
  if (!ID.test(cardId) || !ID.test(externalId) || !(confidence >= 0 && confidence <= 1)) continue
  const rows = await sql`
    insert into card_edition_link (card_id, edition, external_id, method, confidence, verified)
    values (${cardId}, 'ja', ${externalId}, 'auto', ${confidence}, false)
    on conflict (card_id, edition) do update set external_id = excluded.external_id, confidence = excluded.confidence
    where card_edition_link.method = 'auto' and not card_edition_link.verified
    returning card_id`
  written += rows.length
}
console.log(`Automatic links written: ${written}/${links.length}`)

const verdicts = process.argv[2]
if (verdicts) {
  const lines = (await readFile(verdicts, 'utf8')).split(/\r?\n/).slice(1).filter(Boolean)
  let marked = 0
  for (const line of lines) {
    const [cardId, externalId, verdict] = line.split('\t')
    if (!ID.test(cardId ?? '')) continue
    if (verdict === 'ok' && ID.test(externalId ?? '')) {
      await sql`insert into card_edition_link (card_id, edition, external_id, method, confidence, verified)
        values (${cardId}, 'ja', ${externalId}, 'manual', 1, true)
        on conflict (card_id, edition) do update set external_id = excluded.external_id, method = 'manual', confidence = 1, verified = true`
    } else if (verdict === 'none') {
      await sql`insert into card_edition_link (card_id, edition, external_id, method, confidence, verified)
        values (${cardId}, 'ja', '', 'none', 1, true)
        on conflict (card_id, edition) do update set external_id = '', method = 'none', confidence = 1, verified = true`
    } else if (verdict === 'wrong') {
      // Not this print: keep it hidden ('manual' so the next automatic load doesn't bring it back)
      await sql`update card_edition_link set method = 'manual', confidence = 0, verified = false
        where card_id = ${cardId} and edition = 'ja'`
    } else continue
    marked++
  }
  console.log(`qa verdicts applied: ${marked}`)
}
