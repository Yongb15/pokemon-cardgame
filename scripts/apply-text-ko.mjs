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

// Attack/Ability names per card for the move search: card id → [[English, 한국어], …]
const movesById = new Map()

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
    // A card's moves are shown in Korean all together or not at all: a half-Korean card reads worse
    // than English. A move is translated when its name is, and its text too if it has one.
    const cardMoves = [...(card.abilities ?? []), ...(card.attacks ?? [])]
    const whole = cardMoves.every((move) => own(names, move.name) && (!move.text || own(texts, move.text)))
    for (const move of cardMoves) {
      moves++
      delete move.nameKo
      delete move.textKo
      if (!whole) continue
      move.nameKo = own(names, move.name)
      if (move.text) move.textKo = own(texts, move.text)
      movesKo++
      changed = true
    }
    if (card.rules?.length) {
      const rulesKo = card.rules.map((rule) => own(texts, rule))
      if (rulesKo.every(Boolean)) {
        card.rulesKo = rulesKo
        changed = true
      }
    }
    if (changed) touched++
    if (cardMoves.length) movesById.set(card.id, cardMoves.map((m) => (m.nameKo ? [m.name, m.nameKo] : [m.name])))
  }
  await writeFile(full, JSON.stringify(list))
}
// data/index.json (written by build-data.mjs) gets each card's move names, so the API can search them
const indexFile = path.join(root, 'data/index.json')
const index = JSON.parse(await readFile(indexFile, 'utf8'))
for (const entry of index) {
  const list = movesById.get(entry.id)
  if (list) entry.moves = list
  else delete entry.moves
}
await writeFile(indexFile, JSON.stringify(index))

console.log(`Korean card text: ${touched}/${cards} cards, ${movesKo}/${moves} attacks and Abilities fully translated`)
