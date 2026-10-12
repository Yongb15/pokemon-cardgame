// Adds our Korean translations of attack/Ability names and card texts to data/cards/<set>.json
// (scripts/card-text-ko.json: { names: { English: 한국어 }, texts: { English: 한국어 } }). All of them
// are our own translations, shown as unofficial on the site; the English stays alongside.
//
//   node scripts/apply-text-ko.mjs          (also run at the end of build-data.mjs)

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const { names, texts } = JSON.parse(await readFile(path.join(root, 'scripts/card-text-ko.json'), 'utf8'))
const own = (dict, key) => (key && Object.hasOwn(dict, key) ? dict[key] : undefined)

let cards = 0
let touched = 0
let moves = 0
let movesKo = 0
for (const file of await readdir(path.join(root, 'data/cards'))) {
  const full = path.join(root, 'data/cards', file)
  const list = JSON.parse(await readFile(full, 'utf8'))
  for (const card of list) {
    cards++
    let changed = false
    for (const move of [...(card.abilities ?? []), ...(card.attacks ?? [])]) {
      moves++
      const nameKo = own(names, move.name)
      const textKo = own(texts, move.text)
      if (nameKo) move.nameKo = nameKo
      if (textKo) move.textKo = textKo
      if (nameKo || textKo) changed = true
      // A move counts as Korean when everything it says is (no text, or its text translated)
      if (nameKo && (!move.text || textKo)) movesKo++
    }
    if (card.rules?.length) {
      const rulesKo = card.rules.map((rule) => own(texts, rule))
      if (rulesKo.every(Boolean)) {
        card.rulesKo = rulesKo
        changed = true
      }
    }
    if (changed) touched++
  }
  await writeFile(full, JSON.stringify(list))
}
console.log(`Korean card text: ${touched}/${cards} cards, ${movesKo}/${moves} attacks and Abilities fully translated`)
