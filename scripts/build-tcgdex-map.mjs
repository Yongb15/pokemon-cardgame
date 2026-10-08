// Maps our card ids (pokemon-tcg-data, "sv6-25") to TCGdex card ids ("sv06-025"), which the price
// fetcher needs. Writes data/tcgdex-map.json, committed so the mapping is fixed until rebuilt.
//
//   node scripts/build-tcgdex-map.mjs
//
// Sets match by id pattern (sv6 → sv06, sv3pt5 → sv03.5), then by name, then by SET_OVERRIDES.
// Cards match by number (ignoring leading zeros and case) and must have the same name.
// One request per set, 200 ms apart (TCGdex is free; be polite).

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const HOST = 'https://api.tcgdex.net/v2/en'

// Sets whose id and name both differ (ours → TCGdex)
const SET_OVERRIDES = {
  cel25c: 'cel25cc',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { redirect: 'error' })
    if (res.ok) return res.json()
    if (res.status === 404) return null
    if (attempt === 3) throw new Error(`${res.status} ${url}`)
    await sleep(1000 * attempt)
  }
}

const loose = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
const number = (n) => n.toLowerCase().replace(/^0+(?=\w)/, '')

/** Candidate TCGdex ids for one of our set ids */
function setIdCandidates(id) {
  const dotted = id.replace(/pt5/, '.5')
  const padded = dotted.replace(/^([a-z]+)(\d)(?=\D|$)/, '$10$2')
  return [...new Set([id, dotted, padded])]
}

const ourSets = JSON.parse(await readFile(path.join(root, 'data/sets.json'), 'utf8'))
const index = JSON.parse(await readFile(path.join(root, 'data/index.json'), 'utf8'))
const theirSets = await get(`${HOST}/sets`)
const theirById = new Map(theirSets.map((s) => [s.id, s]))
const theirByName = new Map(theirSets.map((s) => [loose(s.name), s]))

const map = {}
const unmatchedSets = []
let unmatchedCards = 0
for (const set of ourSets) {
  const theirId =
    SET_OVERRIDES[set.id] ??
    setIdCandidates(set.id).find((id) => theirById.has(id)) ??
    theirByName.get(loose(set.name))?.id
  if (!theirId) {
    unmatchedSets.push(`${set.id} (${set.name})`)
    continue
  }
  await sleep(200)
  const detail = await get(`${HOST}/sets/${encodeURIComponent(theirId)}`)
  const byNumber = new Map((detail?.cards ?? []).map((c) => [number(c.localId), c]))
  for (const card of index.filter((c) => c.set === set.id)) {
    const theirs = byNumber.get(number(card.number))
    if (theirs && loose(theirs.name) === loose(card.name)) map[card.id] = theirs.id
    else unmatchedCards++
  }
  process.stdout.write(`\r  ${set.id.padEnd(12)} → ${theirId.padEnd(12)}`)
}
process.stdout.write('\n')

await writeFile(path.join(root, 'data/tcgdex-map.json'), JSON.stringify(map))
console.log(`Mapped ${Object.keys(map).length}/${index.length} cards; ${unmatchedCards} cards and ${unmatchedSets.length} sets unmatched`)
if (unmatchedSets.length) console.log('Unmatched sets:', unmatchedSets.join(', '))
