// Matches English cards to their Japanese prints (Scarlet & Violet and Mega Evolution era) for
// Japanese prices (docs/price/design.md, step 5). The Cardmarket product ids differ between
// editions, so cards match on what's printed: Pokédex number + HP, then attack damage, illustrator
// and rarity. Trainers have no number to anchor on: they match inside the Japanese sets the English
// set's Pokémon came from, on trainer type, then the artwork itself (a hash of the picture, which is
// the same in both languages), or — without images — a unique illustrator + rarity match.
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
const jaTrainers = []
/** Printed set size per Japanese set: numbers past it are secret / art-rare slots */
const jaOfficial = new Map()
for (const [i, set] of sets.entries()) {
  const detail = await cached(`set-${set.id}`, `${HOST}/sets/${encodeURIComponent(set.id)}`)
  if (detail?.cardCount?.official) jaOfficial.set(set.id, detail.cardCount.official)
  for (const brief of detail?.cards ?? []) {
    const card = await cached(`card-${brief.id}`, `${HOST}/cards/${encodeURIComponent(brief.id)}`)
    if (card?.category === 'Pokemon') jaCards.push(card)
    else if (card?.category === 'Trainer') jaTrainers.push(card)
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
const enPrinted = new Map(JSON.parse(await readFile(path.join(root, 'data/sets.json'), 'utf8')).map((s) => [s.id, s.printedTotal]))
const enCards = []
for (const setId of ourSets) {
  for (const en of JSON.parse(await readFile(path.join(root, `data/cards/${setId}.json`), 'utf8'))) {
    // Special English-only prints ("Pikachu Rare" art) have no Japanese counterpart (qa)
    if (en.supertype === 'Pokémon' && en.nationalPokedexNumbers?.length && en.rarity !== 'Pikachu Rare') enCards.push({ setId, en })
  }
}

// A rarity TCGdex doesn't know ("None", empty) can't rule a print out
const knownRarity = (r) => !!norm(r) && norm(r) !== 'none'
const jaSet = (ja) => ja.id.slice(0, ja.id.lastIndexOf('-'))

/** Past the printed set size: a secret / special slot (unknown when the number isn't plain) */
const pastTotal = (number, total) => (/^\d+$/.test(String(number)) && total ? Number(number) > total : null)

/** Scores the Japanese candidates of an English card (best first) */
function score(en, nativeSets, setId) {
  const scored = []
  const enSecret = pastTotal(en.number, enPrinted.get(setId))
  for (const ja of byKey.get(`${en.nationalPokedexNumbers[0]}:${Number(en.hp)}`) ?? []) {
    // Secret matches secret, regular matches regular: a regular card isn't its set's full-art slot,
    // and an English special print isn't a Japanese regular one (qa round 2)
    const jaSecret = pastTotal(ja.localId, jaOfficial.get(jaSet(ja)))
    if (enSecret !== null && jaSecret !== null && enSecret !== jaSecret) continue
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
    const [best, second] = score(en, null, setId)
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
    const [best, ...rest] = score(en, nativeSetsOf.get(setId), setId)
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


// --- Trainers ------------------------------------------------------------------------------------
// Images: ours (GitHub Pages) and TCGdex's Japanese "low" picture. TCGdex lists no image for some
// Japanese sets, but often serves one at the usual address: try it; a 404 means "match without it".
const sharp = (await import('sharp')).default
const SM = 'https://yongb15.github.io/pokemon-card-images-sm'
const enImage = (id) => `${SM}/${id.slice(0, id.lastIndexOf('-'))}/${id}.webp`
const jaImage = (c) => c.image ? `${c.image}/low.webp` : `https://assets.tcgdex.net/ja/${c.id.startsWith('SV') ? 'SV' : 'M'}/${jaSet(c)}/${c.localId}/low.webp`
const HASHES = path.join(CACHE, 'hashes.json')
const hashes = JSON.parse(await readFile(HASHES, 'utf8').catch(() => '{}'))
/** Difference hash of the artwork window (upper middle of a Trainer card): 256 bits, or null */
async function artHash(url) {
  if (url in hashes) return hashes[url]
  let bits = null
  try {
    await sleep(80)
    const res = await fetch(url, { redirect: 'error' })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const box = { left: Math.round(meta.width * 0.08), top: Math.round(meta.height * 0.1), width: Math.round(meta.width * 0.84), height: Math.round(meta.height * 0.42) }
      const px = await sharp(buf).extract(box).grayscale().resize(17, 16, { fit: 'fill' }).raw().toBuffer()
      bits = ''
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += px[y * 17 + x] > px[y * 17 + x + 1] ? '1' : '0'
    }
  } catch {
    bits = null
  }
  hashes[url] = bits
  return bits
}
const hamming = (a, b) => [...a].reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0)
/** Same picture: well under half the bits apart, and clearly closer than the next candidate (prototype: 18–26 vs 73–110) */
const SAME_ART = 45
const ART_MARGIN = 25

const TRAINER_TYPE = { Item: 'item', Supporter: 'supporter', Stadium: 'stadium', Tool: 'tool', 'Pokémon Tool': 'tool' }
const enTrainerType = (subtypes) => (subtypes ?? []).map((t) => TRAINER_TYPE[t]).find(Boolean)
const trainerStats = { trainers: 0, art: 0, meta: 0, none: 0 }
for (const setId of ourSets) {
  const native = nativeSetsOf.get(setId)
  if (!native?.size) continue
  const printed = enPrinted.get(setId)
  for (const en of JSON.parse(await readFile(path.join(root, `data/cards/${setId}.json`), 'utf8'))) {
    if (en.supertype !== 'Trainer') continue
    trainerStats.trainers++
    const type = enTrainerType(en.subtypes)
    const enSecret = pastTotal(en.number, printed)
    const candidates = jaTrainers.filter((ja) => {
      if (!native.has(jaSet(ja)) || TRAINER_TYPE[ja.trainerType] !== type) return false
      if (en.regulationMark && ja.regulationMark && en.regulationMark !== ja.regulationMark) return false
      const jaSecret = pastTotal(ja.localId, jaOfficial.get(jaSet(ja)))
      if (enSecret !== null && jaSecret !== null && enSecret !== jaSecret) return false
      return !(knownRarity(en.rarity) && knownRarity(ja.rarity) && norm(en.rarity) !== norm(ja.rarity))
    })
    if (!candidates.length) {
      trainerStats.none++
      continue
    }
    let best = null
    let why = ''
    let compared = false
    // 1) The artwork, when both pictures exist
    const mine = await artHash(enImage(en.id))
    if (mine) {
      const scored = []
      for (const ja of candidates) {
        const theirs = await artHash(jaImage(ja))
        if (theirs) scored.push({ ja, d: hamming(mine, theirs) })
      }
      compared = scored.length > 0
      scored.sort((a, b) => a.d - b.d)
      const [first, second] = scored
      if (first && first.d <= SAME_ART && (!second || second.d - first.d >= ART_MARGIN)) {
        best = { ja: first.ja, confidence: 0.95 }
        why = `art(${first.d}${second ? `/${second.d}` : ''})`
      }
    }
    // 2) Only when no picture could be compared at all: one candidate with the same illustrator (and
    // rarity, if known). Pictures that exist but don't decide mean "not sure", not "ask the illustrator":
    // that guess was wrong twice in qa's sample (sv4pt5-81, sv4pt5-82)
    if (!best && !compared) {
      const same = candidates.filter((ja) => !!norm(en.artist) && norm(en.artist) === norm(ja.illustrator))
      if (same.length === 1) {
        const rarityToo = knownRarity(en.rarity) && norm(en.rarity) === norm(same[0].rarity)
        best = { ja: same[0], confidence: rarityToo ? 0.9 : 0.85 }
        why = rarityToo ? 'type+illustrator+rarity' : 'type+illustrator'
      }
    }
    if (!best) {
      trainerStats.none++
      continue
    }
    trainerStats[why.startsWith('art') ? 'art' : 'meta']++
    links.push({ cardId: en.id, externalId: best.ja.id, confidence: best.confidence })
    const our = index.find((c) => c.id === en.id)
    review.push(
      [en.id, en.name, our?.nameKo ?? '', best.ja.id, best.ja.name, best.ja.rarity ?? '', en.rarity ?? '', enImage(en.id), jaImage(best.ja), best.confidence, `trainer:${why}`].join('\t'),
    )
  }
  process.stdout.write(`\r  trainers ${setId.padEnd(10)} art ${trainerStats.art} · meta ${trainerStats.meta} · none ${trainerStats.none}   `)
}
process.stdout.write('\n')
await writeFile(HASHES, JSON.stringify(hashes))

await writeFile(path.join(root, 'data/ja-links.json'), JSON.stringify(links))
await writeFile(
  path.join(root, 'data/ja-links-review.tsv'),
  'en_id\ten_name\tko_name\tja_id\tja_name\tja_rarity\ten_rarity\ten_image\tja_image\tconfidence\treason\n' +
    review.sort((a, b) => Number(a.split('\t')[9]) - Number(b.split('\t')[9])).join('\n') +
    '\n',
)
const high = links.filter((l) => l.confidence >= 0.9).length
console.log(`Linked ${links.length} English cards (${high} with confidence ≥ 0.9); Trainers ${JSON.stringify(trainerStats)}`)
