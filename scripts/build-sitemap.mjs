// Writes public/sitemap.xml (home + every card page) from data/index.json before each build.
// The file is generated, so it is not committed (.gitignore).

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://pokemon-card-dex-green.vercel.app'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = JSON.parse(await readFile(path.join(root, 'data/index.json'), 'utf8'))
const { tcgDataCommit } = JSON.parse(await readFile(path.join(root, 'data/meta.json'), 'utf8'))

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const urls = [`${SITE}/`, ...index.map((card) => `${SITE}/cards/${encodeURIComponent(card.id)}`)]

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<!-- card data: pokemon-tcg-data@${tcgDataCommit.slice(0, 7)} -->`,
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((url) => `<url><loc>${escapeXml(url)}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

await writeFile(path.join(root, 'public/sitemap.xml'), xml)
console.log(`sitemap.xml: ${urls.length} URLs`)
