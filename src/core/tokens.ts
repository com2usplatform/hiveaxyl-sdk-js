import { expiresAtOf } from './expiry'

/**
 * `true` for a string that has a character other than whitespace.
 * It matches `!string.IsNullOrWhiteSpace` in the Unity SDK.
 */
export const isNonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/** The tokens of a token response that passed the checks, and their expiry time in epoch milliseconds. */
export interface CheckedTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/**
 * Checks the `data` of a token response instead of trusting the server.
 * An empty or whitespace-only token is unusable, as in the Unity SDK.
 * Returns which token is missing, the access token first. The caller words the failure.
 * Otherwise it returns the tokens and computes the expiry time with `now`.
 */
export function sessionTokensOf(
  data: unknown,
  now: () => number,
): CheckedTokens | 'noAccessToken' | 'noRefreshToken' {
  const { accessToken, refreshToken, expiresIn } = (data ?? {}) as {
    readonly accessToken?: unknown
    readonly refreshToken?: unknown
    readonly expiresIn?: unknown
  }
  if (!isNonBlank(accessToken)) return 'noAccessToken'
  if (!isNonBlank(refreshToken)) return 'noRefreshToken'
  return { accessToken, refreshToken, expiresAt: expiresAtOf(expiresIn, accessToken, now) }
}
