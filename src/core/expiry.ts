import { decodeBase64Url } from './encoding'
import { isRecord, jsonParse } from './json'

/**
 * Returns when the access token expires, in milliseconds since the Unix epoch.
 * Token issue after sign-in and token refresh both use it.
 * It adds `expiresIn` to the time the token arrived.
 * It cannot use the response `Date` header, because a browser reads only the headers that CORS exposes.
 * It reads the JWT `exp` claim only when `expiresIn` is missing. It returns 0 (unknown) when both are missing.
 * The rule matches `AuthTokenRefreshHandler.ComputeExpiresAtSec` in the Unity SDK.
 * Infinite values and values of 0 or less count as missing. An app timer based on the result never gets a strange value.
 */
export function expiresAtOf(expiresIn: unknown, accessToken: string, now: () => number): number {
  const at = isPositiveFinite(expiresIn)
    ? now() + expiresIn * 1000
    : (readJwtExp(accessToken) ?? 0) * 1000
  // A huge `expiresIn` or `exp` overflows to Infinity when converted to milliseconds. Treat it as unknown (0).
  // An overflowing `expiresIn` does not fall back to the JWT `exp`: the server sent a value, and it is unusable.
  return Number.isFinite(at) ? at : 0
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Longest token whose expiry the SDK reads. Longer tokens are treated as having an unknown expiry. */
const MAX_JWT_LENGTH = 16_384

/** Does not verify the signature. It only reads the expiry of a token received from our server over TLS. */
function readJwtExp(jwt: string): number | null {
  // A real access token is far shorter. Skip reading the expiry of an unusually long one.
  if (jwt.length > MAX_JWT_LENGTH) return null
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const parsed: unknown = jsonParse(decodeBase64Url(payload))
    const exp = isRecord(parsed) ? parsed['exp'] : undefined
    return isPositiveFinite(exp) ? exp : null
  } catch {
    return null
  }
}
