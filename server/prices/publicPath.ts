// The price functions (api/price-*.ts) are reached through rewrites from their public paths. Their
// own file paths would answer too, a second URL for the same data; answer only the public one
// (Security I-2b, the "one URL per answer" rule of C-1).

const notFound = () =>
  new Response(JSON.stringify({ error: { message: 'Not found', code: 404 } }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/** Runs `handle` only when the request's path is exactly `publicPath` (checked before any parameter) */
export function atPublicPath(request: Request, publicPath: string, handle: (params: URLSearchParams) => Response | Promise<Response>) {
  const url = new URL(request.url)
  return url.pathname === publicPath ? handle(url.searchParams) : notFound()
}
