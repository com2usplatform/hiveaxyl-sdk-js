import { AUTH_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import { transportFailureOf } from '../../core/refusal'
import type { RefreshVerdict } from '../../core/session'
import { sessionTokensOf } from '../../core/tokens'
import type { CallFn } from '../../core/transport'

/** The server API spec that the refresh call follows. It is the same API as `issueToken`. */
export const SPEC = 'token.openapi.yaml'

/** Request body of the `refresh_token` grant. */
interface RefreshTokenRequest {
  readonly body: {
    /** Token grant type. Always `refresh_token`. */
    readonly grantType: 'refresh_token'
    /** OAuth client identifier. */
    readonly clientId: string
    /** The most recently issued refresh token. An earlier one is already invalid. */
    readonly refreshToken: string
  }
}

/** Server response of the token API. */
interface TokenResponse {
  /** Access token. */
  readonly accessToken: string
  /** Refresh token. */
  readonly refreshToken: string | null
  /** Remaining lifetime in seconds (RFC 6749 §5.1). */
  readonly expiresIn: number
}

/**
 * Call description for token refresh. It is the same API as `issueToken` in the token spec.
 * Feature modules do not import each other, so the `auth` module keeps its own copy.
 */
export const refreshTokenOp = op<RefreshTokenRequest, TokenResponse>()({
  id: 'issueToken',
  method: 'POST',
  path: '/token/v1/issue',
  credential: 'anonymous',
  params: { body: 'body' },
  sensitiveResponse: true,
  // A refresh request is never resent. It is sent once even on 429 or 5xx, as in the Unity SDK.
  retry: false,
  outcomes: [
    'invalid_client',
    'unsupported_grant_type',
    'invalid_grant',
    'invalid_grant_expired',
    'invalid_grant_code_challenge',
    'invalid_grant_refresh_token',
    'app_not_found',
    'temporarily_unavailable',
  ],
  // The token spec declares only these three common errors, as in the Unity SDK.
  failures: AUTH_FAILURES,
})

/**
 * Refreshes tokens with the same rules as the Unity SDK.
 * - It does not retry. A refresh token becomes invalid as soon as it is used.
 *   If the response is lost, a resend would be rejected and could sign the player out.
 * - Only `invalid_grant_refresh_token` counts as a rejection.
 *   Any other failure gives no verdict, and the session is kept.
 * - A success with an empty token counts as a failure.
 */
export function createRefresher(call: CallFn, clientId: string, now: () => number) {
  return async (refreshToken: string, signal: AbortSignal): Promise<RefreshVerdict> => {
    const r = await call(
      refreshTokenOp,
      { body: { grantType: 'refresh_token', clientId, refreshToken } },
      { signal },
    )
    switch (r.kind) {
      case 'success': {
        // An empty or whitespace-only token is unusable. This matches `IsNullOrWhiteSpace` in the Unity SDK.
        const tokens = sessionTokensOf(r.data, now)
        if (typeof tokens === 'string') {
          return { kind: 'failed', message: 'Refresh succeeded but the tokens are unusable.' }
        }
        return { kind: 'renewed', ...tokens }
      }
      case 'outcome':
        return r.code === 'invalid_grant_refresh_token'
          ? { kind: 'rejected', message: 'The refresh token was rejected.' }
          : { kind: 'failed', message: `Refresh failed: ${r.code}` }
      case 'unknownOutcome':
        return { kind: 'failed', message: `Refresh failed: ${r.code}` }
      case 'failure': {
        if (r.error.code === 'Cancelled') return { kind: 'cancelled' }
        // A failure where the refresh request got no response.
        // If the refresh started because the access token expired, it does not count toward ending the session.
        const transport = transportFailureOf(r.error.externalCode)
        return {
          kind: 'failed',
          message: `Refresh failed: ${r.error.code}`,
          ...(transport !== undefined && { transport }),
        }
      }
    }
  }
}
