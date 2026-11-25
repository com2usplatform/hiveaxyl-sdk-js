import { AUTH_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type { IssueTokenRequest, TokenResponse } from './types'

/** The server API spec that this module follows. */
export const SPEC = 'token.openapi.yaml'

/**
 * Issues tokens. Follows `token.openapi.yaml`.
 * The server-only `introspectToken` is not included.
 * The `auth` module covers the `refresh_token` variant of the same API.
 * The response holds tokens, so `raw` is left empty.
 */
export const issueToken = op<IssueTokenRequest, TokenResponse>()({
  id: 'issueToken',
  method: 'POST',
  path: '/token/v1/issue',
  credential: 'anonymous',
  params: { body: 'body' },
  sensitiveResponse: true,
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
  failures: AUTH_FAILURES,
})
