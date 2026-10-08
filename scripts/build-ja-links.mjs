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
const links = []
const review = []
for (const setId of ourSets) {
  const cards = JSON.parse(await readFile(path.join(root, `data/cards/${setId}.json`), 'utf8'))
  for (const en of cards) {
    if (en.supertype !== 'Pokémon' || !en.nationalPokedexNumbers?.length) continue
    const candidates = byKey.get(`${en.nationalPokedexNumbers[0]}:${Number(en.hp)}`) ?? []
    let best = null
    for (const ja of candidates) {
      const checks = [
        ['damage', 0.25, damages(en.attacks) === damages(ja.attacks)],
        ['illustrator', 0.2, !!norm(en.artist) && norm(en.artist) === norm(ja.illustrator)],
        ['rarity', 0.05, norm(en.rarity) === norm(ja.rarity)],
      ].filter(([, , ok]) => ok)
      const score = 0.5 + checks.reduce((sum, [, weight]) => sum + weight, 0)
      const why = ['dex+hp', ...checks.map(([name]) => name)]
      if (!best || score > best.score) best = { ja, score, why, ties: 0 }
      else if (score === best.score) best.ties++
    }
    if (!best) continue
    // Several equally good Japanese prints (reprints, alternate arts): less sure which one
    const confidence = Math.max(0, Math.round((best.score - (best.ties ? 0.2 : 0)) * 100) / 100)
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
