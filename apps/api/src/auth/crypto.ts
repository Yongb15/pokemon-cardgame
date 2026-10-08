// Small crypto helpers for sign-in: random tokens, hashes, PKCE and the sealed oauth cookie

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest()

/** PKCE S256: the challenge sent to the provider for the verifier we keep */
export const pkceChallenge = (verifier: string) => sha256(verifier).toString('base64url')

/** Constant-time string comparison (false for different lengths) */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Bound into every sealed value, so a value sealed for something else can't be replayed here
const AAD = Buffer.from('card-dex/oauth/v1')

/** AES-256-GCM: the oauth cookie is both secret (verifier, nonce) and tamper-proof */
export function seal(value: unknown, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

/** The sealed value, or null for anything forged, truncated or sealed with another key */
export function unseal(sealed: string, key: Buffer): unknown {
  try {
    const raw = Buffer.from(sealed, 'base64url')
    if (raw.length < 29) return null
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAAD(AAD)
    decipher.setAuthTag(raw.subarray(12, 28))
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
