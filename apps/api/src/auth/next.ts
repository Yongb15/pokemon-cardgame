/**
 * Where to go after sign-in: a path on our own site only, never another origin (open redirect).
 * Anything doubtful becomes "/" (Security: ≤200 characters, starts with one "/", no "//", "/\",
 * backslashes, control characters or dot segments, same origin after parsing; API paths are not
 * pages). The parsed result is checked again: "/.//evil.com" normalises to "//evil.com" (S3-1).
 */
export function safeNext(input: unknown, origin: string): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) return '/'
  if (!input.startsWith('/') || input.startsWith('//')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return '/'
  // Dot segments, plain or encoded: our pages never need them
  if (/%2e/i.test(input) || /(^|\/)\.{1,2}(\/|\?|#|$)/.test(input)) return '/'
  let url: URL
  try {
    url = new URL(input, origin)
  } catch {
    return '/'
  }
  if (url.origin !== new URL(origin).origin) return '/'
  const out = url.pathname + url.search
  return isSafePath(out) ? out : '/'
}

/** The final shape check, also run right before the redirect (defence in depth) */
export function isSafePath(path: string) {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    path !== '/api' &&
    !path.startsWith('/api/') &&
    !path.startsWith('/api?')
  )
}
