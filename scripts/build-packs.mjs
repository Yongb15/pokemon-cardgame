// The card pool behind the card packs (docs/auction/packs.md §1): for each pack set, its card ids
// by pack slot tier, taken from data/index.json. Committed so anyone can check what the published
// odds draw from; CI regenerates it and fails on any difference (Security (a)).
//
//   node scripts/build-packs.mjs          writes apps/api/src/packs/pool.json
//   node scripts/build-packs.mjs --check  exits 1 if the committed file differs

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const OUT = path.join(root, 'apps/api/src/packs/pool.json')

/** The pack sets, newest first (one structure: common / uncommon / rare tiers) */
const PACK_SETS = ['me5', 'me4', 'me3', 'me2pt5', 'me2', 'me1']

/** Our tiers for each printed rarity; anything else isn't in packs */
const TIER = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  'Double Rare': 'double',
  'Illustration Rare': 'illustration',
  'Ultra Rare': 'ultra',
  MEGA_ATTACK_RARE: 'ultra',
  'Special Illustration Rare': 'sir',
  'Mega Hyper Rare': 'hyper',
  'Hyper Rare': 'hyper',
}

const index = JSON.parse(await readFile(path.join(root, 'data/index.json'), 'utf8'))
const sets = JSON.parse(await readFile(path.join(root, 'data/sets.json'), 'utf8'))

const pool = {
  sets: PACK_SETS.map((id) => {
    const set = sets.find((s) => s.id === id)
    if (!set) throw new Error(`unknown set ${id}`)
    const tiers = {}
    for (const card of index.filter((c) => c.set === id)) {
      const tier = TIER[card.rarity]
      // Basic Energy never fills a slot (none in these sets today; kept out if one appears)
      if (!tier || (card.supertype === 'Energy' && card.subtypes?.includes('Basic'))) continue
      ;(tiers[tier] ??= []).push(card.id)
    }
    for (const list of Object.values(tiers)) list.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    if (!tiers.common?.length || !tiers.uncommon?.length || !tiers.rare?.length) throw new Error(`${id}: missing a base tier`)
    return { id, nameKo: set.nameKo, releaseDate: set.releaseDate.replaceAll('/', '-'), tiers }
  }),
}

const text = JSON.stringify(pool, null, 1) + '\n'
if (process.argv.includes('--check')) {
  const committed = await readFile(OUT, 'utf8').catch(() => '')
  if (committed.replace(/\r\n/g, '\n') !== text) {
    console.error('apps/api/src/packs/pool.json is out of date: run node scripts/build-packs.mjs')
    process.exit(1)
  }
  console.log('pool.json matches data/index.json')
} else {
  await writeFile(OUT, text)
  const count = pool.sets.reduce((n, s) => n + Object.values(s.tiers).flat().length, 0)
  console.log(`wrote ${pool.sets.length} sets, ${count} cards`)
}
