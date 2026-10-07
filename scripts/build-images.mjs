// Downloads every card's large image once and stores two WebP sizes we host ourselves, so the
// site keeps its images after the Pokémon TCG API (and possibly its image CDN) shuts down.
//
//   node scripts/build-images.mjs <outDir> [--concurrency 6]
//
// Output: <outDir>/sm/<setId>/<cardId>.webp  (245px wide, card tiles)
//         <outDir>/lg/<setId>/<cardId>.webp  (440px wide, detail page)
//         <outDir>/sm/_sets/<setId>/{logo,symbol}.png  (set logos and symbols, unchanged)
// Re-running skips images that already exist, so an interrupted run can simply be resumed.
// The two folders are published as separate GitHub Pages sites (each must stay under 1 GB).

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) {
  console.error('usage: node scripts/build-images.mjs <outDir> [--concurrency N]')
  process.exit(1)
}
const concurrencyArg = process.argv.indexOf('--concurrency')
const CONCURRENCY = concurrencyArg > 0 ? Number(process.argv[concurrencyArg + 1]) : 6

export const SIZES = {
  sm: { width: 245, quality: 80 },
  lg: { width: 440, quality: 72 },
}

const exists = (file) => stat(file).then(() => true, () => false)

/** Card ids become file names and URLs: unsafe characters become their hex code so ids stay
 *  distinct ("ex10-?" → "ex10-_3f", "ex10-!" → "ex10-_21").
 *  server/cardsApi.ts uses the same rule. */
const imageName = (id) => id.replace(/[^\w.-]/g, (ch) => `_${ch.codePointAt(0).toString(16)}`)

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      if (res.status === 404 || attempt === 5) throw new Error(`${res.status} ${url}`)
    } catch (error) {
      if (attempt === 5) throw error
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

const setFiles = (await readdir(path.join(root, 'data/cards'))).filter((f) => f.endsWith('.json'))
const jobs = []
for (const file of setFiles) {
  const setId = file.replace(/\.json$/, '')
  for (const card of JSON.parse(await readFile(path.join(root, 'data/cards', file), 'utf8'))) {
    // Prefer the large image; fall back to the small one if a card has no large image
    jobs.push({ setId, id: card.id, urls: [card.images.large, card.images.small].filter(Boolean) })
  }
}

let done = 0
let skipped = 0
const failed = []
const started = Date.now()

async function work(job) {
  const targets = Object.entries(SIZES).map(([size, opts]) => ({
    file: path.join(outDir, size, job.setId, `${imageName(job.id)}.webp`),
    opts,
  }))
  if ((await Promise.all(targets.map((t) => exists(t.file)))).every(Boolean)) {
    skipped++
    return
  }
  // Some cards have no large image on the original server (404): use the small one instead
  let source
  for (const [i, url] of job.urls.entries()) {
    try {
      source = await download(url)
      break
    } catch (error) {
      if (i === job.urls.length - 1) throw error
    }
  }
  for (const { file, opts } of targets) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, await sharp(source).resize({ width: opts.width, withoutEnlargement: true }).webp({ quality: opts.quality }).toBuffer())
  }
}

let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try {
        await work(job)
      } catch (error) {
        failed.push({ id: job.id, urls: job.urls, error: String(error) })
      }
      done++
      if (done % 250 === 0 || done === jobs.length) {
        const rate = done / ((Date.now() - started) / 1000)
        console.log(`${done}/${jobs.length} (skipped ${skipped}, failed ${failed.length}) ${rate.toFixed(1)}/s`)
      }
    }
  }),
)

// Set logos and symbols: small PNGs, stored as they are
for (const set of JSON.parse(await readFile(path.join(root, 'data/sets.json'), 'utf8'))) {
  for (const kind of ['logo', 'symbol']) {
    const file = path.join(outDir, 'sm', '_sets', set.id, `${kind}.png`)
    if (await exists(file)) continue
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, await download(set.images[kind]))
    } catch (error) {
      failed.push({ id: `${set.id}/${kind}`, url: set.images[kind], error: String(error) })
    }
  }
}

await writeFile(path.join(outDir, 'failed.json'), JSON.stringify(failed, null, 2))
console.log(`Done: ${jobs.length - failed.length}/${jobs.length} images, ${failed.length} failed (see failed.json)`)
