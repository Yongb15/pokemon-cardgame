// Cards the pokemon-tcg-data snapshot doesn't have (promos and energies it stopped adding), taken from
// TCGdex and turned into the same shape, so build-data.mjs treats them like any other card.
//
//   node scripts/fetch-tcgdex-extra.mjs           → scripts/extra-cards.json (committed)
//   node scripts/fetch-tcgdex-extra.mjs --check   → compare with cards both sources have (no write)
//
// Card text and stats from TCGdex (https://tcgdex.dev, MIT); images from its asset host, downloaded and
// re-hosted by scripts/build-images.mjs like the others.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const API = 'https://api.tcgdex.net/v2/en'
// The pokemon-tcg-data snapshot build-data.mjs uses (written by it to data/meta.json)
const { tcgDataCommit } = JSON.parse(await readFile(path.join(root, 'data/meta.json'), 'utf8'))
const TCG_RAW = `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/${tcgDataCommit}`

/**
 * Our set id → TCGdex set id. Sets we already have only get the cards they're missing; new sets
 * carry their own metadata (pokemon-tcg-data style).
 */
const SETS = [
  { id: 'svp', tcgdex: 'svp' },
  { id: 'sve', tcgdex: 'sve' },
  { id: 'swshp', tcgdex: 'swshp' },
  // No logo or symbol of their own anywhere: the series logo and the matching promo/energy symbol
  { id: 'mfb', tcgdex: 'mfb', series: 'Scarlet & Violet', ptcgoCode: 'MFB', images: { symbol: 'https://images.pokemontcg.io/svp/symbol.png', logo: 'https://images.pokemontcg.io/sv1/logo.png' } },
  { id: 'mep', tcgdex: 'mep', series: 'Mega Evolution', ptcgoCode: 'MEP', images: { symbol: 'https://images.pokemontcg.io/svp/symbol.png', logo: 'https://images.pokemontcg.io/me1/logo.png' } },
  { id: 'mee', tcgdex: 'mee', series: 'Mega Evolution', ptcgoCode: 'MEE', images: { symbol: 'https://images.pokemontcg.io/sve/symbol.png', logo: 'https://images.pokemontcg.io/me1/logo.png' } },
]

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
    if (attempt === 4) throw new Error(`${res.status} ${url}`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

const STAGE = { Basic: 'Basic', Stage1: 'Stage 1', Stage2: 'Stage 2', BREAK: 'BREAK', MEGA: 'MEGA', VMAX: 'VMAX', VSTAR: 'VSTAR' }
const TRAINER = { Item: 'Item', Supporter: 'Supporter', Stadium: 'Stadium', Tool: 'Pokémon Tool' }
const MEGA_EX_RULE = 'Mega Evolution ex Rule: When your Mega Evolution Pokémon ex is Knocked Out, your opponent takes 3 Prize cards.'
const RULES = {
  ex: 'Pokémon ex rule: When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards.',
  Item: 'You may play any number of Item cards during your turn.',
  Supporter: 'You may play only 1 Supporter card during your turn.',
  Stadium:
    'You may play only 1 Stadium card during your turn. Put it next to the Active Spot, and discard it if another Stadium comes into play. A Stadium with the same name can\'t be played.',
  'Pokémon Tool':
    'You may attach any number of Pokémon Tools to your Pokémon during your turn. You may attach only 1 Pokémon Tool to each Pokémon, and it stays attached.',
  'ACE SPEC': "ACE SPEC: You can't have more than 1 ACE SPEC card in your deck.",
}
// TCGdex writes energy as {L}; pokemon-tcg-data spells it out, glued when repeated ("ColorlessColorless",
// which the site draws as icons: EnergyText)
const SYMBOL = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' }
const text = (t) => (t ?? '').replace(/[{[]([GRWLPFDMYNC])[}\]]/g, (_, k) => SYMBOL[k]).replace(/\s+/g, ' ').trim()
/** TCGdex writes damage as a number or "30+", "60×"; ours are strings like the printed card */
const damage = (d) => (d === undefined || d === null ? '' : String(d))

/** One TCGdex card in pokemon-tcg-data's shape (the fields the site reads) */
export function convert(c, setId) {
  const number = /^\d+$/.test(c.localId) ? String(Number(c.localId)) : c.localId
  const supertype = c.category === 'Pokemon' ? 'Pokémon' : c.category
  const subtypes = []
  if (supertype === 'Pokémon') {
    if (c.stage && STAGE[c.stage]) subtypes.push(STAGE[c.stage])
    // Mega Evolution ex ("Mega Latias ex"): its own rule, 3 Prize cards, as in me1
    if (/^Mega .+ ex$/.test(c.name) && !subtypes.includes('MEGA')) subtypes.push('MEGA')
    if (/ ex$/.test(c.name)) subtypes.push('ex')
  } else if (supertype === 'Trainer') {
    if (c.trainerType && TRAINER[c.trainerType]) subtypes.push(TRAINER[c.trainerType])
    if (/ACE SPEC/i.test(c.rarity ?? '')) subtypes.push('ACE SPEC')
  } else if (c.energyType) subtypes.push(c.energyType)

  const rules = []
  if (supertype !== 'Pokémon' && c.effect) rules.push(text(c.effect))
  if (subtypes.includes('MEGA') && subtypes.includes('ex')) rules.push(MEGA_EX_RULE)
  else for (const s of subtypes) if (RULES[s] && !(supertype === 'Pokémon' && s !== 'ex')) rules.push(RULES[s])

  const id = `${setId}-${number}`
  // Basic energy is "Basic Grass Energy" (subtype Basic) in pokemon-tcg-data, "Grass Energy" (Normal) on
  // TCGdex: the Korean name and the deck rules (any number of basic energy) go by the former
  const basicEnergy = supertype === 'Energy' && c.energyType === 'Normal'
  if (basicEnergy) subtypes.splice(0, subtypes.length, 'Basic')
  const name = basicEnergy && /^\w+ Energy$/.test(c.name) ? `Basic ${c.name}` : c.name
  const card = {
    id,
    name,
    supertype,
    subtypes: subtypes.length ? subtypes : undefined,
    hp: c.hp ? String(c.hp) : undefined,
    types: c.types,
    evolvesFrom: c.evolveFrom,
    abilities: c.abilities?.map((a) => ({ name: a.name, text: text(a.effect), type: a.type ?? 'Ability' })),
    attacks: c.attacks?.map((a) => ({
      name: a.name,
      cost: a.cost ?? [],
      convertedEnergyCost: (a.cost ?? []).length,
      damage: damage(a.damage),
      text: text(a.effect),
    })),
    weaknesses: c.weaknesses?.map((w) => ({ type: w.type, value: w.value ?? '×2' })),
    resistances: c.resistances?.map((r) => ({ type: r.type, value: r.value ?? '-30' })),
    retreatCost: c.retreat ? Array.from({ length: c.retreat }, () => 'Colorless') : undefined,
    convertedRetreatCost: c.retreat,
    rules: rules.length ? rules : undefined,
    number,
    artist: c.illustrator,
    rarity: c.rarity === 'None' ? undefined : c.rarity,
    nationalPokedexNumbers: c.dexId,
    legalities: {
      unlimited: 'Legal',
      ...(c.legal?.standard && { standard: 'Legal' }),
      ...(c.legal?.expanded && { expanded: 'Legal' }),
    },
    regulationMark: c.regulationMark,
    // TCGdex has pictures for few of these; scrydex (same ids as ours) has most. build-images.mjs re-hosts
    // them and marks its "no image" card back as missing, like the other sets
    images: { small: `https://images.scrydex.com/pokemon/${id}/small`, large: `https://images.scrydex.com/pokemon/${id}/large` },
    source: 'tcgdex',
  }
  for (const key of Object.keys(card)) if (card[key] === undefined) delete card[key]
  return card
}

// TCGdex has no Tera / Ancient / Future marks. Promos are mostly reprints: take them from the same card
// in our data (name, HP, types and attack names alike). Paradox Pokémon are Ancient or Future by name.
const TAGS = ['Tera', 'Ancient', 'Future']
const TERA_RULE = "Tera: As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks (both yours and your opponent's)."
const sameCard = (c) => [c.name, c.hp ?? '', (c.types ?? []).join('/'), (c.attacks ?? []).map((a) => a.name).join('/')].join('|')
const known = new Map()
const byName = new Map()
for (const file of await (await import('node:fs/promises')).readdir(path.join(root, 'data/cards'))) {
  for (const c of JSON.parse(await readFile(path.join(root, 'data/cards', file), 'utf8'))) {
    const tags = (c.subtypes ?? []).filter((t) => TAGS.includes(t))
    if (!tags.length) continue
    known.set(sameCard(c), { tags })
    for (const t of tags) if (t !== 'Tera') byName.set(c.name.replace(/ ex$/, ''), t)
  }
}
function addTags(card) {
  const hit = known.get(sameCard(card))
  const tags = hit?.tags ?? (byName.has(card.name.replace(/ ex$/, '')) ? [byName.get(card.name.replace(/ ex$/, ''))] : [])
  if (!tags.length) return card
  card.subtypes = [...(card.subtypes ?? []), ...tags.filter((t) => !card.subtypes?.includes(t))]
  if (tags.includes('Tera')) card.rules = [TERA_RULE, ...(card.rules ?? [])]
  return card
}

const check = process.argv.includes('--check')
const out = { _comment: 'From TCGdex by scripts/fetch-tcgdex-extra.mjs; merged by build-data.mjs', sets: [], cards: {} }

for (const s of SETS) {
  const set = await get(`${API}/sets/${s.tcgdex}`)
  // What the pokemon-tcg-data snapshot has (not data/cards, which already holds earlier additions)
  let have = new Set()
  const snapshot = await fetch(`${TCG_RAW}/cards/en/${s.id}.json`)
  if (snapshot.ok) have = new Set((await snapshot.json()).map((c) => c.number))
  const wanted = set.cards.filter((c) => (check ? have.has(String(Number(c.localId))) : !have.has(/^\d+$/.test(c.localId) ? String(Number(c.localId)) : c.localId)))
  const cards = []
  for (const brief of wanted) cards.push(addTags(convert(await get(`${API}/cards/${brief.id}`), s.id)))
  console.log(`${s.id}: ${set.cards.length} on TCGdex, ${have.size} here, ${cards.length} ${check ? 'to compare' : 'added'}`)
  out.cards[s.id] = cards
  if (!have.size && s.series) {
    out.sets.push({
      id: s.id,
      name: set.name,
      series: s.series,
      printedTotal: set.cardCount?.official ?? set.cardCount?.total,
      total: set.cardCount?.total,
      ptcgoCode: s.ptcgoCode,
      releaseDate: (set.releaseDate ?? '').replaceAll('-', '/'),
      images: s.images ?? { symbol: set.symbol ? `${set.symbol}.png` : '', logo: set.logo ? `${set.logo}.png` : '' },
    })
  }
}

if (check) {
  // Field-by-field against pokemon-tcg-data for the cards both have
  const fields = ['name', 'supertype', 'subtypes', 'hp', 'types', 'evolvesFrom', 'abilities', 'attacks', 'weaknesses', 'resistances', 'retreatCost', 'rules', 'artist', 'nationalPokedexNumbers', 'regulationMark']
  const pick = (card, f) => {
    const v = card[f]
    if (f === 'attacks') return v?.map((a) => [a.name, a.cost, a.damage, a.text])
    if (f === 'abilities') return v?.map((a) => [a.name, a.text])
    return v
  }
  const diff = Object.fromEntries(fields.map((f) => [f, 0]))
  const examples = []
  let n = 0
  for (const [setId, cards] of Object.entries(out.cards)) {
    if (!cards.length) continue
    const theirs = new Map(JSON.parse(await readFile(path.join(root, `data/cards/${setId}.json`), 'utf8')).map((c) => [c.number, c]))
    for (const ours of cards) {
      const t = theirs.get(ours.number)
      if (!t) continue
      n++
      for (const f of fields) {
        if (JSON.stringify(pick(ours, f) ?? null) !== JSON.stringify(pick(t, f) ?? null)) {
          diff[f]++
          if (examples.length < 40 && (f === 'artist' || examples.length < 4)) examples.push(`${t.id} ${f}: tcgdex=${JSON.stringify(pick(ours, f))?.slice(0, 110)} | ours=${JSON.stringify(pick(t, f))?.slice(0, 110)}`)
        }
      }
    }
  }
  console.log(`compared ${n} cards; differing fields:`, diff)
  for (const e of examples) console.log('  ' + e)
} else {
  await writeFile(path.join(root, 'scripts/extra-cards.json'), JSON.stringify(out, null, 1) + '\n')
  console.log('written scripts/extra-cards.json')
}
