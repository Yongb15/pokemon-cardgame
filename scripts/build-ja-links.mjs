// Matches English cards to their Japanese prints (Scarlet & Violet and Mega Evolution era) for
// Japanese prices (docs/price/design.md, step 5). The Cardmarket product ids differ between
// editions, so cards match on what's printed: Pokédex number + HP, then attack damage, illustrator
// and rarity. Pokémon only for now (Trainers have no number to anchor on).
//
//   node scripts/build-ja-links.mjs
//
// Writes data/ja-links.json (for scripts/db-load-ja-links.mjs) and data/ja-links-review.tsv (for qa).
// TCGdex responses are cached in .cache/tcgdex-ja/ (gitignored), fetched 150 ms apart.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const CACHE = path.join(root, '.cache/tcgdex-ja')
const HOST = 'https://api.tcgdex.net/v2/ja'
const OUR_SETS = /^(sv\d|sv\dpt5|sv10|rsv10pt5|zsv10pt5|me\d|me\dpt5|me55)$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cached(name, url) {
  const file = path.join(CACHE, `${name.replace(/[^\w.-]/g, '_')}.json`)
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    await sleep(150)
    const res = await fetch(url, { redirect: 'error' })
    if (!res.ok) return null
    const body = await res.json()
    await writeFile(file, JSON.stringify(body))
    return body
  }
}

await mkdir(CACHE, { recursive: true })
const sets = (await cached('sets', `${HOST}/sets`)).filter((s) => /^(SV|M)/i.test(s.id) && !/^(SV-P|M-P|MC)$/.test(s.id))
const jaCards = []
for (const [i, set] of sets.entries()) {
  const detail = await cached(`set-${set.id}`, `${HOST}/sets/${encodeURIComponent(set.id)}`)
  for (const brief of detail?.cards ?? []) {
    const card = await cached(`card-${brief.id}`, `${HOST}/cards/${encodeURIComponent(brief.id)}`)
    if (card?.category === 'Pokemon') jaCards.push(card)
  }
  process.stdout.write(`\r  ja ${i + 1}/${sets.length} ${set.id.padEnd(8)} ${jaCards.length} Pokémon`)
}
process.stdout.write('\n')

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9+×x]/g, '')
const damages = (attacks) => (attacks ?? []).map((a) => norm(a.damage)).join('|')
const byKey = new Map()
for (const c of jaCards) {
  for (const dex of c.dexId ?? []) {
    const key = `${dex}:${c.hp}`
    byKey.set(key, [...(byKey.get(key) ?? []), c])
  }
}

const index = JSON.parse(await readFile(path.join(root, 'data/index.json'), 'utf8'))
const ourSets = [...new Set(index.filter((c) => OUR_SETS.test(c.set)).map((c) => c.set))]
const enCards = []
for (const setId of ourSets) {
  for (const en of JSON.parse(await readFile(path.join(root, `data/cards/${setId}.json`), 'utf8'))) {
    if (en.supertype === 'Pokémon' && en.nationalPokedexNumbers?.length) enCards.push({ setId, en })
  }
}

// A rarity TCGdex doesn't know ("None", empty) can't rule a print out
const knownRarity = (r) => !!norm(r) && norm(r) !== 'none'
const jaSet = (ja) => ja.id.slice(0, ja.id.lastIndexOf('-'))

/** Scores the Japanese candidates of an English card (best first) */
function score(en, nativeSets) {
  const scored = []
  for (const ja of byKey.get(`${en.nationalPokedexNumbers[0]}:${Number(en.hp)}`) ?? []) {
    // Both rarities known and different: another print, not this one (qa sample: 4 of 6 were wrong)
    if (knownRarity(en.rarity) && knownRarity(ja.rarity) && norm(en.rarity) !== norm(ja.rarity)) continue
    const checks = [
      ['damage', 0.25, damages(en.attacks) === damages(ja.attacks)],
      ['illustrator', 0.2, !!norm(en.artist) && norm(en.artist) === norm(ja.illustrator)],
      ['rarity', 0.05, norm(en.rarity) === norm(ja.rarity)],
    ].filter(([, , ok]) => ok)
    let value = 0.5 + checks.reduce((sum, [, weight]) => sum + weight, 0)
    const why = ['dex+hp', ...checks.map(([name]) => name)]
    // Outside the sets this English set was made from: a reprint or a collection print (qa)
    if (nativeSets && !nativeSets.has(jaSet(ja))) {
      value -= 0.15
      why.push('other-set')
    }
    scored.push({ ja, score: value, why })
  }
  return scored.sort((a, b) => b.score - a.score)
}

// The Japanese sets each English set was made from, learned from its surest matches: the sets
// holding at least 10% of them (one English set can come from several: sv10 ← SV10, SV9a)
const nativeSetsOf = new Map()
for (const setId of ourSets) {
  const counts = new Map()
  let total = 0
  for (const { en } of enCards.filter((c) => c.setId === setId)) {
    const [best, second] = score(en, null)
    if (!best || best.score < 0.95 || (second && second.score === best.score)) continue
    counts.set(jaSet(best.ja), (counts.get(jaSet(best.ja)) ?? 0) + 1)
    total++
  }
  nativeSetsOf.set(setId, new Set([...counts].filter(([, n]) => n >= total * 0.1).map(([s]) => s)))
}

const links = []
const review = []
for (const { setId, en } of enCards) {
  {
    const [best, ...rest] = score(en, nativeSetsOf.get(setId))
    if (!best) continue
    const ties = rest.filter((r) => r.score === best.score).length
    // Several equally good Japanese prints (reprints, alternate arts): less sure which one
    const confidence = Math.max(0, Math.round((best.score - (ties ? 0.2 : 0)) * 100) / 100)
    best.ties = ties
    links.push({ cardId: en.id, externalId: best.ja.id, confidence })
    const our = index.find((c) => c.id === en.id)
    review.push(
      [
        en.id,
        en.name,
        our?.nameKo ?? '',
        best.ja.id,
        best.ja.name,
        best.ja.rarity ?? '',
        en.rarity ?? '',
        en.images?.small ?? '',
        best.ja.image ? `${best.ja.image}/low.webp` : '',
        confidence,
        best.why.join('+') + (best.ties ? ` (${best.ties + 1} candidates)` : ''),
      ].join('\t'),
    )
  }
}

await writeFile(path.join(root, 'data/ja-links.json'), JSON.stringify(links))
await writeFile(
  path.join(root, 'data/ja-links-review.tsv'),
  'en_id\ten_name\tko_name\tja_id\tja_name\tja_rarity\ten_rarity\ten_image\tja_image\tconfidence\treason\n' +
    review.sort((a, b) => Number(a.split('\t')[9]) - Number(b.split('\t')[9])).join('\n') +
    '\n',
)
const high = links.filter((l) => l.confidence >= 0.9).length
console.log(`Linked ${links.length} English Pokémon cards (${high} with confidence ≥ 0.9)`)
