// Draws public/og-image.png, the 1200×630 picture shown in link previews (KakaoTalk, Slack, X, ...).
// Run by hand when the look changes: node scripts/build-og-image.mjs
// Text is drawn with the system's Korean font, so run it on a machine that has Noto Sans KR or Malgun Gothic.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const WIDTH = 1200
const HEIGHT = 630
const IMAGE_HOST = 'https://yongb15.github.io/pokemon-card-images-lg'

// Back to front: the middle card is drawn last so it sits on top
const CARDS = [
  { id: 'me55-64', x: 672, y: 124, angle: -12 }, // Mewtwo ex
  { id: 'me55-23', x: 880, y: 124, angle: 12 }, // Pikachu
  { id: 'sv4pt5-54', x: 776, y: 100, angle: 0 }, // Charizard ex
]
const CARD_WIDTH = 270
const CARD_HEIGHT = Math.round((CARD_WIDTH * 342) / 245)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function cardImage(id) {
  const setId = id.slice(0, id.lastIndexOf('-'))
  const res = await fetch(`${IMAGE_HOST}/${setId}/${id}.webp`)
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
  const radius = 12
  const mask = Buffer.from(
    `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}"><rect width="100%" height="100%" rx="${radius}" /></svg>`,
  )
  return sharp(Buffer.from(await res.arrayBuffer()))
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

/** A card turned by `angle` degrees, with a soft shadow, placed so its center stays put */
async function placedCard({ id, x, y, angle }) {
  const pad = 40
  const w = CARD_WIDTH + pad * 2
  const h = CARD_HEIGHT + pad * 2
  const shadow = Buffer.from(
    `<svg width="${w}" height="${h}"><defs><filter id="s"><feGaussianBlur stdDeviation="14" /></filter></defs>
      <rect x="${pad}" y="${pad + 12}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="12" fill="rgb(0,0,0)" fill-opacity="0.35" filter="url(#s)" /></svg>`,
  )
  const framed = await sharp(shadow)
    .composite([{ input: await cardImage(id), left: pad, top: pad }])
    .png()
    .toBuffer()
  const { data, info } = await sharp(framed)
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true })
  return {
    input: data,
    left: Math.round(x + CARD_WIDTH / 2 - info.width / 2),
    top: Math.round(y + CARD_HEIGHT / 2 - info.height / 2),
  }
}

const FONT = `'Noto Sans KR', 'Malgun Gothic', sans-serif`
const background = Buffer.from(`
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="78%" cy="50%" r="55%">
      <stop offset="0" stop-color="#e3350d" stop-opacity="0.28" />
      <stop offset="1" stop-color="#e3350d" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#18181b" />
  <rect width="100%" height="100%" fill="url(#glow)" />
  <rect width="100%" height="10" fill="#e3350d" />

  <g transform="translate(72 150)">
    <circle cx="28" cy="28" r="25" fill="#fff" stroke="#09090b" stroke-width="4" />
    <path d="M3 28a25 25 0 0 1 50 0z" fill="#e3350d" stroke="#09090b" stroke-width="4" />
    <path d="M3 28h50" stroke="#09090b" stroke-width="4" />
    <circle cx="28" cy="28" r="8" fill="#fff" stroke="#09090b" stroke-width="4" />
  </g>
  <text x="72" y="290" font-family="${FONT}" font-size="76" font-weight="700" fill="#fafafa">포켓몬 카드 도감</text>
  <text x="74" y="350" font-family="${FONT}" font-size="36" font-weight="500" fill="#a1a1aa">Pokémon Card Dex</text>
  <text x="74" y="440" font-family="${FONT}" font-size="30" font-weight="500" fill="#ffb4a3">카드 20,635장 · 한국어 이름 검색</text>
  <text x="74" y="560" font-family="${FONT}" font-size="24" fill="#71717a">pokemon-card-dex-green.vercel.app</text>
</svg>`)

const cards = []
for (const card of CARDS) cards.push(await placedCard(card))

const png = await sharp(background).composite(cards).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer()
await writeFile(path.join(root, 'public/og-image.png'), png)
console.log(`og-image.png: ${WIDTH}×${HEIGHT}, ${png.length.toLocaleString()} bytes`)
