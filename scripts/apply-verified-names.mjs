// Moves names checked against the official Korean card search (pokemoncard.co.kr) into the
// `official` section of scripts/card-names-ko.json.
//
//   node scripts/apply-verified-names.mjs <file.tsv>
//
// The TSV has a header row and the columns english, official_ko (further columns are ignored).
// Then run `npm run build:data`.

import { readFile, writeFile } from 'node:fs/promises'

const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/apply-verified-names.mjs <file.tsv>')

const dictPath = new URL('./card-names-ko.json', import.meta.url)
const dict = JSON.parse(await readFile(dictPath, 'utf8'))
const rows = (await readFile(file, 'utf8'))
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => line.split('\t'))

const problems = []
for (const [en, ko] of rows) {
  // Plain text only: no control/format characters, markup or surrounding spaces
  if (!en || !ko || ko !== ko.trim() || /[\p{Cc}\p{Cf}<>"`\\]/u.test(ko)) {
    problems.push(`bad row: ${en} → ${ko}`)
    continue
  }
  if (!Object.hasOwn(dict.names, en) && !Object.hasOwn(dict.official, en)) problems.push(`not a translated name: ${en}`)
  dict.official[en] = ko
  delete dict.names[en]
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'en')))
dict.official = sorted(dict.official)
await writeFile(dictPath, JSON.stringify(dict, null, 2) + '\n')

console.log(`Applied ${rows.length - problems.filter((p) => p.startsWith('bad')).length} names`)
if (problems.length) console.log(problems.join('\n'))
