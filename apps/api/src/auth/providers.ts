// Sign-in providers (OpenID Connect, authorization code + PKCE). Every provider goes through the
// same id_token check; only the endpoints, issuers and keys differ (docs/auth/design.md, Security).

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Config } from '../config.js'
import type { Provider as ProviderName } from '../db/schema.js'
import { safeEqual } from './crypto.js'

export interface AuthorizeParams {
  state: string
  nonce: string
  challenge: string
  /** Test provider only: which test account to sign in as */
  testSubject?: string
}

export interface Provider {
  name: ProviderName
  /** Where the browser goes to sign in (absolute for real providers) */
  authorizeUrl(params: AuthorizeParams): string
  /** The provider's id_token for the code the callback received */
  exchange(code: string, verifier: string): Promise<string>
  /** The account's subject, once every check on the id_token passed */
  verify(idToken: string, nonce: string): Promise<string>
}

/** Any failure in the provider steps; the message is for logs only and never holds token data */
export class SignInError extends Error {
  override name = 'SignInError'
}

interface VerifyRules {
  keys: JWTVerifyGetKey
  issuers: string[]
  clientId: string
}

/**
 * RS256 only, exact issuer, our client id as audience (and as azp when present), 60 s of clock
 * skew, and the nonce we sent (Security: id_token rules)
 */
export async function verifyIdToken(idToken: string, nonce: string, rules: VerifyRules): Promise<string> {
  let payload
  try {
    ;({ payload } = await jwtVerify(idToken, rules.keys, {
      issuer: rules.issuers,
      audience: rules.clientId,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
    }))
  } catch (error) {
    throw new SignInError(`id_token rejected: ${error instanceof Error ? error.name : 'unknown'}`)
  }
  if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) throw new SignInError('nonce mismatch')
  if (payload.azp !== undefined && payload.azp !== rules.clientId) throw new SignInError('azp mismatch')
  const sub = payload.sub
  if (typeof sub !== 'string' || sub.length < 1 || sub.length > 255) throw new SignInError('bad subject')
  return sub
}

/** POST to the token endpoint; only the id_token is kept (no access or refresh tokens are stored) */
async function exchangeAtTokenEndpoint(url: string, form: Record<string, string>): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    throw new SignInError(`token endpoint unreachable: ${error instanceof Error ? error.name : 'unknown'}`)
  }
  if (!res.ok) throw new SignInError(`token endpoint answered ${res.status}`)
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null
  if (typeof body?.id_token !== 'string') throw new SignInError('no id_token')
  return body.id_token
}

/** One OpenID provider's fixed endpoints, from its discovery document (never fetched at run time) */
interface Endpoints {
  authorize: string
  token: string
  jwks: string
  issuers: string[]
}

// accounts.google.com/.well-known/openid-configuration
const GOOGLE: Endpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
}

// kauth.kakao.com/.well-known/openid-configuration (RS256, PKCE S256)
const KAKAO: Endpoints = {
  authorize: 'https://kauth.kakao.com/oauth/authorize',
  token: 'https://kauth.kakao.com/oauth/token',
  jwks: 'https://kauth.kakao.com/.well-known/jwks.json',
  issuers: ['https://kauth.kakao.com'],
}

/** The redirect_uri is fixed by configuration, never built from the request's Host (Security) */
export const callbackUrl = (config: Config, provider: ProviderName) =>
  `${config.PUBLIC_ORIGIN}/api/v1/auth/${provider}/callback`

interface OidcClient {
  name: ProviderName
  endpoints: Endpoints
  clientId: string
  clientSecret: string
  redirectUri: string
  keys: JWTVerifyGetKey
}

/** Authorization code flow with state, nonce and PKCE, the same for every real provider */
function oidcProvider({ name, endpoints, clientId, clientSecret, redirectUri, keys }: OidcClient): Provider {
  return {
    name,
    authorizeUrl({ state, nonce, challenge }) {
      const url = new URL(endpoints.authorize)
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        // Sign-in only: no e-mail or profile consent (Security: openid only)
        scope: 'openid',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString()
      return url.toString()
    },
    exchange: (code, verifier) =>
      exchangeAtTokenEndpoint(endpoints.token, {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    verify: (idToken, nonce) => verifyIdToken(idToken, nonce, { keys, issuers: endpoints.issuers, clientId }),
  }
}

export function googleProvider(config: Config, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE.jwks))): Provider {
  return oidcProvider({
    name: 'google',
    endpoints: GOOGLE,
    clientId: config.GOOGLE_CLIENT_ID!,
    clientSecret: config.GOOGLE_CLIENT_SECRET!,
    redirectUri: callbackUrl(config, 'google'),
    keys,
  })
}

export function kakaoProvider(config: Config, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(KAKAO.jwks))): Provider {
  return oidcProvider({
    name: 'kakao',
    endpoints: KAKAO,
    clientId: config.KAKAO_CLIENT_ID!,
    clientSecret: config.KAKAO_CLIENT_SECRET!,
    redirectUri: callbackUrl(config, 'kakao'),
    keys,
  })
}
