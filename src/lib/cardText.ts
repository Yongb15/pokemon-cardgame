// Korean display text and formatting for card fields. Names come translated from the data build
// (scripts/build-data.mjs); attack text and rules stay in English.

export const SUBTYPE_LABEL: Record<string, string> = {
  Basic: '기본',
  'Stage 1': '1진화',
  'Stage 2': '2진화',
  Item: '아이템',
  Supporter: '서포트',
  Stadium: '스타디움',
  'Pokémon Tool': '포켓몬의 도구',
  Special: '특수',
}

export const LEGALITY_FORMAT_LABEL = {
  standard: '스탠다드',
  expanded: '익스팬디드',
  unlimited: '언리미티드',
} as const

// Rarities as the data names them; Korean cards print short codes (C, U, R, RR, AR, SAR…), so the
// labels spell those out
const RARITY_KO: Record<string, string> = {
  Common: '커먼',
  Uncommon: '언커먼',
  Rare: '레어',
  'Rare Holo': '레어 홀로',
  'Double Rare': '더블 레어',
  'Ultra Rare': '울트라 레어',
  'Rare Ultra': '울트라 레어(구)',
  'Illustration Rare': '일러스트 레어',
  'Special Illustration Rare': '스페셜 일러스트 레어',
  'Hyper Rare': '하이퍼 레어',
  'Mega Hyper Rare': '메가 하이퍼 레어',
  MEGA_ATTACK_RARE: '메가 어택 레어',
  'Black White Rare': '블랙·화이트 레어',
  'ACE SPEC Rare': 'ACE SPEC 레어',
  'Shiny Rare': '샤이니 레어',
  'Shiny Ultra Rare': '샤이니 울트라 레어',
  'Pikachu Rare': '피카츄 레어',
  'Futuristic Rare': '퓨처 레어',
  'Rare Secret': '시크릿 레어',
  'Rare Rainbow': '레인보우 레어',
  'Rare Shiny': '샤이니 레어(구)',
  'Rare Shiny GX': '샤이니 GX 레어',
  'Rare Shining': '빛나는 레어',
  'Rare Holo ex': '레어 홀로 ex',
  'Rare Holo EX': '레어 홀로 EX',
  'Rare Holo GX': '레어 홀로 GX',
  'Rare Holo V': '레어 홀로 V',
  'Rare Holo VMAX': '레어 홀로 VMAX',
  'Rare Holo VSTAR': '레어 홀로 VSTAR',
  'Holo Rare V': '레어 홀로 V(특별판)',
  'Holo Rare VMAX': '레어 홀로 VMAX(특별판)',
  'Holo Rare VSTAR': '레어 홀로 VSTAR(특별판)',
  'Rare Holo LV.X': '레어 홀로 LV.X',
  'Rare Holo Star': '레어 홀로 스타',
  'Rare Prime': '레어 프라임',
  'Rare BREAK': '레어 BREAK',
  'Rare Prism Star': '프리즘스타 레어',
  'Rare ACE': 'ACE SPEC 레어(구)',
  LEGEND: '레전드',
  'Amazing Rare': '어메이징 레어',
  'Radiant Rare': '찬란한 레어',
  'Trainer Gallery Rare Holo': '트레이너 갤러리 레어',
  'Classic Collection': '클래식 컬렉션',
  Promo: '프로모',
}

/** "Double Rare" → "더블 레어"; an unknown rarity (a new set) shows as the data has it */
export function rarityLabel(rarity: string) {
  return Object.hasOwn(RARITY_KO, rarity) ? RARITY_KO[rarity] : rarity
}

/** "6" → "#006"; non-numeric numbers like "TG05" or "SWSH001" stay as they are */
export function formatCardNumber(number: string) {
  return /^\d+$/.test(number) ? `#${number.padStart(3, '0')}` : `#${number}`
}

/** API dates look like "2023/09/22" (sometimes with a time after a space) */
export function formatDate(value: string, style: 'long' | 'short' = 'long') {
  const [y, m, d] = value.split(' ')[0].split('/').map(Number)
  if (!y || !m || !d) return value
  return style === 'long' ? `${y}년 ${m}월 ${d}일` : `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`
}

/**
 * The name to search the list with for "other printings", dropping mechanic suffixes and
 * parenthesized variants: "Charizard ex" → "Charizard", "Zekrom-GX" → "Zekrom",
 * "Professor's Research (Professor Magnolia)" → "Professor's Research".
 */
export function baseName(name: string) {
  return (
    name
      .replace(/\s*\(.*\)\s*$/u, '')
      .replace(/((\s+|-)(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Prime|LEGEND|δ|◇|☆|Star))+$/u, '')
      .trim() || name
  )
}
