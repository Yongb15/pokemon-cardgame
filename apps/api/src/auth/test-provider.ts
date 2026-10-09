// Preview-only test sign-in (qa L-1): a fake OpenID provider inside the server, so qa can sign in
// from an automated browser and still run the real callback, id_token check and session code.
//
// Security conditions (docs/auth/design.md): registered only with APP_ENV=preview and
// AUTH_TEST_PROVIDER=1 against the dev database; accounts live under provider 'test' only; its own
// issuer and a key made at start-up, which no real provider's checks trust.

import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { pkceChallenge, randomToken, safeEqual } from './crypto.js'
import { SignInError, verifyIdToken, type Provider } from './providers.js'

const ISSUER = 'https://test-login.card-dex.invalid'
const CLIENT_ID = 'card-dex-test'
/** Audience of the fake authorization codes: a code can never pass as an id_token */
const CODE_AUDIENCE = 'card-dex-test-code'

/** Test account names: short lowercase words, e.g. "qa1" */
export const TEST_SUBJECT = /^[a-z0-9-]{1,32}$/

export interface TestProvider extends Provider {
  /** The fake provider's consent step: a signed, 60-second code for this account */
  issueCode(subject: string, nonce: string, challenge: string): Promise<string>
}

export async function createTestProvider(): Promise<TestProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }] })
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(ISSUER).setIssuedAt()
  // Codes work once, like a real provider's (per instance; they expire in 60 s anyway)
  const usedCodes = new Map<string, number>()
  const firstUse = (jti: unknown, exp: unknown) => {
    const now = Date.now() / 1000
    for (const [id, until] of usedCodes) if (until < now) usedCodes.delete(id)
    if (typeof jti !== 'string' || usedCodes.has(jti)) return false
    usedCodes.set(jti, typeof exp === 'number' ? exp : now + 60)
    return true
  }

  return {
    name: 'test',
    authorizeUrl({ state, nonce, challenge, testSubject }) {
      // Relative: the fake provider lives on whichever preview the browser is on
      const params = new URLSearchParams({ state, nonce, code_challenge: challenge, sub: testSubject ?? '' })
      return `/api/v1/auth/test/authorize?${params}`
    },
    issueCode: (subject, nonce, challenge) =>
      sign({ nonce, ch: challenge })
        .setSubject(subject)
        .setAudience(CODE_AUDIENCE)
        .setJti(randomToken(16))
        .setExpirationTime('60s')
        .sign(privateKey),
    async exchange(code, verifier) {
      let payload
      try {
        ;({ payload } = await jwtVerify(code, keys, { issuer: ISSUER, audience: CODE_AUDIENCE, algorithms: ['RS256'] }))
      } catch {
        throw new SignInError('test code rejected')
      }
      if (!firstUse(payload.jti, payload.exp)) throw new SignInError('test code reused')
      if (typeof payload.ch !== 'string' || !safeEqual(payload.ch, pkceChallenge(verifier))) {
        throw new SignInError('PKCE mismatch')
      }
      return sign({ nonce: payload.nonce })
        .setSubject(String(payload.sub))
        .setAudience(CLIENT_ID)
        .setExpirationTime('5m')
        .sign(privateKey)
    },
    verify: (idToken, nonce) => verifyIdToken(idToken, nonce, { keys, issuers: [ISSUER], clientId: CLIENT_ID }),
  }
}
