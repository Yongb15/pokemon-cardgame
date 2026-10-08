/**
 * Where to go after sign-in: a path on our own site only, never another origin (open redirect).
 * Anything doubtful becomes "/" (Security: ≤200 characters, starts with one "/", no "//", "/\",
 * backslashes or control characters, same origin after parsing; API paths are not pages)
 */
export function safeNext(input: unknown, origin: string): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) return '/'
  if (!input.startsWith('/') || input.startsWith('//')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return '/'
  let url: URL
  try {
    url = new URL(input, origin)
  } catch {
    return '/'
  }
  if (url.origin !== new URL(origin).origin) return '/'
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return '/'
  return url.pathname + url.search
}
