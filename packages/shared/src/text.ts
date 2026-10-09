// Rules for user-typed names, shared by the web app and the API server (deck names, nicknames).

/**
 * One line of plain visible text, at most `max` characters: whitespace runs become one space,
 * control and format characters (bidi overrides, zero-width spaces…) go, except the zero-width
 * joiner inside emoji. Returns '' when nothing visible is left, so callers can use a default.
 */
export function cleanText(name: string, max: number) {
  const clean = name
    .replace(/\s+/g, ' ') // tabs and newlines become spaces before the other controls go
    .replace(/(?!‍)[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ') // "a <ZWSP> b" left two spaces
    .slice(0, max)
    .trim() // after cutting, so a space at the last character doesn't stay at the end
  // Nothing visible left (only joiners): treat as no name, so callers fall back to a default
  return /^[\s‍]*$/.test(clean) ? '' : clean
}
