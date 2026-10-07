// Vercel Function: same-origin proxy for the Pokémon TCG API.
//
// The upstream API fails a large share of requests (500/502, without CORS headers, so browsers
// only see a network error). Proxying lets us retry close to the API, hide transient failures
// from the browser, keep an optional API key server-side, and cache good responses at the edge.
//
// Reached through the rewrite /api/tcg/:path* -> /api/tcg?path=:path* in vercel.json.

const UPSTREAM = 'https://api.pokemontcg.io/v2'

// Only the read-only endpoints the app uses; this is not an open proxy.
const ALLOWED_PATH = /^(cards|sets)(\/[\w.-]+)?$|^(rarities|types|subtypes|supertypes)$/

// Stay well under the browser's per-attempt timeout (15s) so the client sees our answer.
const DEADLINE_MS = 12_000
const ATTEMPT_TIMEOUT_MS = 8_000
const RETRY_BASE_DELAY_MS = 250

// Browsers keep their own in-memory copy; the shared edge cache serves everyone else.
const CACHE_OK = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
const CACHE_CLIENT_ERROR = 'public, max-age=0, s-maxage=300'
const NO_STORE = 'no-store'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function json(body: unknown, status: number, cacheControl: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, ...extra },
  })
}

const isTransient = (status: number) => status >= 500 || status === 429

export async function GET(request: Request) {
  const incoming = new URL(request.url)
  const path = incoming.searchParams.get('path') ?? ''
  if (!ALLOWED_PATH.test(path)) {
    return json({ error: { message: 'Not found', code: 404 } }, 404, CACHE_CLIENT_ERROR)
  }

  incoming.searchParams.delete('path')
  const target = new URL(`${UPSTREAM}/${path}`)
  target.search = incoming.searchParams.toString()

  const apiKey = process.env.POKEMON_TCG_API_KEY
  const headers: Record<string, string> = apiKey ? { 'X-Api-Key': apiKey } : {}

  const deadline = Date.now() + DEADLINE_MS
  let lastStatus = 0
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now()
    try {
      const res = await fetch(target, { headers, signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)) })
      lastStatus = res.status
      if (res.ok) {
        // Read fully so a truncated body counts as a failure and is retried
        const body = await res.text()
        JSON.parse(body)
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': CACHE_OK,
            'X-Upstream-Attempts': String(attempt + 1),
          },
        })
      }
      if (!isTransient(res.status)) {
        // 400 (bad query), 404 (unknown card): not worth retrying, pass through as-is
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE_CLIENT_ERROR },
        })
      }
    } catch {
      lastStatus = 0 // network error, timeout, or unreadable body
    }

    const delay = RETRY_BASE_DELAY_MS * 2 ** attempt
    if (Date.now() + delay + 1_000 > deadline) break
    await sleep(delay)
  }

  return json(
    { error: { message: 'Upstream Pokémon TCG API is unavailable', code: 502 } },
    502,
    NO_STORE,
    { 'X-Upstream-Status': String(lastStatus) },
  )
}
