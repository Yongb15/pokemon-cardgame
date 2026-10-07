// Builds the app's own card data, so the site doesn't depend on the Pokémon TCG API
// (it shuts down on 2027-03-01 and fails many requests until then).
//
//   node scripts/build-data.mjs
//
// Sources, pinned to commits so the output is reproducible:
// - PokemonTCG/pokemon-tcg-data — the data behind the Pokémon TCG API (cards and sets)
// - PokeAPI/pokeapi (BSD-3-Clause) — official Korean Pokémon species names
//
// Output (committed):
// - data/index.json         compact list of every card, for search and the list page
// - data/cards/<setId>.json full card details, one file per set
// - src/data/sets.json      sets for the set filter (bundled into the client)
// - src/data/rarities.json  rarities for the rarity filter (bundled into the client)

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TCG_DATA_COMMIT = '39a26a144c8b6ef6c2fb17b2c29d0bb7121e3a11' // 2026-09-17, 30th Celebration
const POKEAPI_COMMIT = '2ee1c422ad9f3831245dab0ac2a5cd1aae61cd72' // 2026-10-06

const TCG_RAW = `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/${TCG_DATA_COMMIT}`
const POKEAPI_RAW = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${POKEAPI_COMMIT}/data/v2/csv`

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KO = '3'
const EN = '9'

async function fetchText(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.text()
    if (attempt === 4) throw new Error(`${res.status} ${url}`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

const fetchJson = async (url) => JSON.parse(await fetchText(url))

/** Minimal CSV parser for PokéAPI's files (quoted fields may contain commas) */
function parseCsv(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const cells = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"'
          i++
        } else if (ch === '"') quoted = false
        else cell += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') {
        cells.push(cell)
        cell = ''
      } else cell += ch
    }
    cells.push(cell)
    rows.push(cells)
  }
  return rows
}

// --- Korean names -----------------------------------------------------------------------------
//
// Policy: translate a name only when every part of it can be translated with confidence.
// A card keeps its English name rather than getting a half-translated mix like "Erika's 뚜벅쵸".

const TYPE_KO = {
  Grass: '풀', Fire: '불꽃', Water: '물', Lightning: '번개', Psychic: '초', Fighting: '격투',
  Darkness: '악', Metal: '강철', Dragon: '드래곤', Fairy: '페어리', Colorless: '무색',
}

// Trainer-owned Pokémon ("Misty's Gyarados" → "이슬의 갸라도스"): official Korean trainer names
const OWNER_KO = {
  'Team Rocket': '로켓단', Rocket: '로켓단', 'Team Magma': '마그마단', 'Team Aqua': '아쿠아단',
  Erika: '민화', Misty: '이슬', Brock: '웅', Sabrina: '초련', Blaine: '강연', 'Lt. Surge': '마티스',
  Koga: '독수', Giovanni: '비주기', N: 'N', Hop: '호브', Ethan: '광', Cynthia: '난천', Iono: '모야모',
  Lillie: '릴리에', Larry: '청목', Marnie: '마리', Arven: '페퍼', Steven: '성호', Ash: '지우', Lance: '목호',
}

// Leading form / mechanic words. `join: true` attaches to the name ("메가리자몽", "화이트큐레무").
const PREFIX_KO = [
  ['Mega', '메가', true],
  ['Primal', '원시', true],
  ['Ultra', '울트라', true],
  ['White', '화이트', true],
  ['Black', '블랙', true],
  ['Alolan', '알로라'],
  ['Galarian', '가라르'],
  ['Hisuian', '히스이'],
  ['Paldean', '팔데아'],
  ['Radiant', '찬란한'],
  ['Shining', '빛나는'],
  ['Dark', '다크'],
  ['Light', '라이트'],
  ['Origin Forme', '오리진', true], // cards print "오리진디아루가", not the game's form name "오리진폼"
  ['Single Strike', '일격'],
  ['Rapid Strike', '연격'],
  ['Ice Rider', '백마'],
  ['Shadow Rider', '흑마'],
  ['Bloodmoon', '붉은달'],
]

// Forms whose Korean name is a single word
const WHOLE_KO = {
  'Heat Rotom': '히트로토무', 'Wash Rotom': '워시로토무', 'Frost Rotom': '프로스트로토무',
  'Fan Rotom': '스핀로토무', 'Mow Rotom': '커트로토무',
}

// Mechanic suffixes and short codes that stay as printed: ex, GX, VMAX, LV.X, "Garchomp C", "Unown A", "M"
const KEEP_LATIN = new Set(['ex', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'V-UNION', 'BREAK', 'LV.X', 'LEGEND', 'Prime', 'Star'])
const isKeptLatin = (word) => KEEP_LATIN.has(word) || /^[A-Z]{1,2}$/.test(word)

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Matches `word` not glued to other letters: "Mew" in "Mew ex" but not in "Mewtwo" */
const wholeWord = (word) => new RegExp(`(?<!\\p{L})${escapeRegExp(word)}(?!\\p{L})`, 'u')
// Compare names ignoring spacing/punctuation: "Nidoran ♀" vs "Nidoran♀", "Mr Mime" vs "Mr. Mime"
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}♀♂]/gu, '')

/** One Pokémon name (no "&"), e.g. "Misty's Rapid Strike Urshifu VMAX" */
function translatePart(part, hints, speciesByName) {
  let rest = part.trim()
  let owner = ''
  const possessive = rest.match(/^(.+?)'s\s+/)
  if (possessive) {
    const ko = OWNER_KO[possessive[1]]
    if (!ko) return null
    owner = `${ko}의 `
    rest = rest.slice(possessive[0].length)
  }

  let prefix = ''
  for (let changed = true; changed; ) {
    changed = false
    for (const [en, ko, join] of PREFIX_KO) {
      if (rest.startsWith(`${en} `)) {
        prefix += join ? ko : `${ko} `
        rest = rest.slice(en.length + 1)
        changed = true
      }
    }
  }

  let translated = false
  for (const [en, ko] of Object.entries(WHOLE_KO)) {
    if (wholeWord(en).test(rest)) {
      rest = rest.replace(wholeWord(en), ko)
      translated = true
    }
  }

  if (!translated) {
    // The card's Pokédex numbers first (they can be wrong in the source), then every species
    const candidates = [...hints, ...speciesByName].filter(({ en }) => wholeWord(en).test(rest))
    candidates.sort((a, b) => b.en.length - a.en.length)
    if (candidates.length) {
      rest = rest.replace(wholeWord(candidates[0].en), candidates[0].ko)
      translated = true
    } else {
      // Spacing/punctuation differences, e.g. "Nidoran ♀" for the species "Nidoran♀"
      const words = rest.split(' ')
      outer: for (let len = Math.min(3, words.length); len >= 1; len--) {
        for (let i = 0; i + len <= words.length; i++) {
          const match = hints.find(({ en }) => loose(words.slice(i, i + len).join(' ')) === loose(en))
          if (match) {
            words.splice(i, len, match.ko)
            rest = words.join(' ')
            translated = true
            break outer
          }
        }
      }
    }
  }
  if (!translated) return null

  // Anything English left besides mechanic suffixes means a form we don't know: don't mix
  const leftover = (rest.match(/[A-Za-z][A-Za-z.'-]*/g) ?? []).map((w) => w.replace(/^-/, ''))
  if (!leftover.every(isKeptLatin)) return null

  // "메가" + "리자몽" joins; other prefixes keep their space
  return owner + prefix + rest
}

/**
 * "Charizard ex" → "리자몽 ex", "Mega Charizard Y ex" → "메가리자몽 Y ex",
 * "Pikachu & Zekrom-GX" → "피카츄 & 제크로무-GX", "Misty's Gyarados" → "이슬의 갸라도스",
 * "Basic Fire Energy" → "기본 불꽃 에너지". Returns null unless the whole name translates.
 */
function koreanName(card, species, speciesByName) {
  if (card.supertype === 'Energy') {
    const m = card.name.match(/^(?:Basic )?(\w+) Energy$/)
    if (m && TYPE_KO[m[1]]) return `기본 ${TYPE_KO[m[1]]} 에너지`
    return null
  }
  if (card.supertype !== 'Pokémon') return null

  const hints = (card.nationalPokedexNumbers ?? []).map((n) => species.get(n)).filter(Boolean)
  const parts = card.name.split(' & ').map((part) => translatePart(part, hints, speciesByName))
  return parts.every(Boolean) ? parts.join(' & ') : null
}

/** "Charmeleon" → "리자드" for the "evolves from" line (a plain species name, sometimes a form) */
function koreanSpeciesName(name, speciesByName) {
  if (!name) return null
  return translatePart(name, [], speciesByName)
}

// --- Build ------------------------------------------------------------------------------------

console.log('Downloading Korean species names…')
const csv = parseCsv(await fetchText(`${POKEAPI_RAW}/pokemon_species_names.csv`))
const species = new Map()
for (const [id, lang, name] of csv.slice(1)) {
  if (lang !== KO && lang !== EN) continue
  const entry = species.get(Number(id)) ?? {}
  entry[lang === KO ? 'ko' : 'en'] = name
  species.set(Number(id), entry)
}
for (const [id, entry] of species) if (!entry.ko || !entry.en) species.delete(id)
const speciesByName = [...species.values()]
console.log(`  ${species.size} species with English and Korean names`)

console.log('Downloading sets…')
const sets = (await fetchJson(`${TCG_RAW}/sets/en.json`)).sort((a, b) =>
  a.releaseDate === b.releaseDate ? a.id.localeCompare(b.id) : a.releaseDate < b.releaseDate ? 1 : -1,
)

await rm(path.join(root, 'data'), { recursive: true, force: true })
await mkdir(path.join(root, 'data/cards'), { recursive: true })

const index = []
const rarities = new Set()
let pokemonCards = 0
let pokemonTranslated = 0
const untranslated = new Map()

for (const [i, set] of sets.entries()) {
  process.stdout.write(`\r  cards ${i + 1}/${sets.length} ${set.id.padEnd(12)}`)
  const cards = await fetchJson(`${TCG_RAW}/cards/en/${set.id}.json`)
  for (const card of cards) {
    const nameKo = koreanName(card, species, speciesByName)
    const evolvesFromKo = koreanSpeciesName(card.evolvesFrom, speciesByName)
    if (evolvesFromKo) card.evolvesFromKo = evolvesFromKo
    if (nameKo) card.nameKo = nameKo
    if (card.supertype === 'Pokémon') {
      pokemonCards++
      if (nameKo) pokemonTranslated++
      else untranslated.set(card.name, card.id)
    }
    if (card.rarity) rarities.add(card.rarity)

    // Fields the list page shows; everything else stays in the per-set detail file
    index.push({
      id: card.id,
      name: card.name,
      ...(nameKo && { nameKo }),
      supertype: card.supertype,
      subtypes: card.subtypes,
      hp: card.hp,
      types: card.types,
      number: card.number,
      rarity: card.rarity,
      dex: card.nationalPokedexNumbers,
      set: set.id,
      image: card.images.small,
    })
  }
  await writeFile(path.join(root, `data/cards/${set.id}.json`), JSON.stringify(cards))
}
process.stdout.write('\n')

const setsOut = sets.map((s) => ({
  id: s.id,
  name: s.name,
  series: s.series,
  printedTotal: s.printedTotal,
  total: s.total,
  releaseDate: s.releaseDate,
  images: s.images,
}))

await writeFile(path.join(root, 'data/index.json'), JSON.stringify(index))
await writeFile(path.join(root, 'data/sets.json'), JSON.stringify(setsOut))
await writeFile(
  path.join(root, 'data/meta.json'),
  JSON.stringify({ tcgDataCommit: TCG_DATA_COMMIT, pokeapiCommit: POKEAPI_COMMIT, cards: index.length, sets: sets.length }, null, 2) + '\n',
)
// Client bundle: the filter selects
await writeFile(
  path.join(root, 'src/data/sets.json'),
  JSON.stringify(setsOut.map(({ id, name, series, releaseDate }) => ({ id, name, series, releaseDate }))).replace(/\},\{/g, '},\n{') + '\n',
)
await writeFile(path.join(root, 'src/data/rarities.json'), JSON.stringify([...rarities].sort(), null, 2) + '\n')

const pct = ((pokemonTranslated / pokemonCards) * 100).toFixed(1)
console.log(`Done: ${index.length} cards in ${sets.length} sets`)
console.log(`Korean names: ${pokemonTranslated}/${pokemonCards} Pokémon cards (${pct}%)`)
if (untranslated.size) {
  console.log(`Untranslated Pokémon names (${untranslated.size} distinct), e.g.:`)
  console.log([...untranslated].slice(0, 25).map(([n, id]) => `  ${n} (${id})`).join('\n'))
}
