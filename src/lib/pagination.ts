/** 1 … 4 5 6 … 18 — always the first, last, and neighbours of the current page */
export function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  // Avoid a lone gap that would hide a single page: "1 … 3" becomes "1 2 3"
  if (page - 1 === 3) pages.add(2)
  if (page + 1 === totalPages - 2) pages.add(totalPages - 1)

  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const items: (number | 'gap')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push('gap')
    items.push(p)
  })
  return items
}
