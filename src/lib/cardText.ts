// Korean display text and formatting for card fields. The API only provides English, so card
// names, attack text and rules stay in English; only labels and well-known terms are translated.

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
