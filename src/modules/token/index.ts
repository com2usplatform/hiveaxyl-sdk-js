import { isStopped } from '../../core/abort'
import { AxylUsageError } from '../../core/errors'
import { HOSTS } from '../../core/hosts'
import { definePrivilegedModule, type ModuleOptions } from '../../core/module'
import { refused } from '../../core/refusal'
import { failure } from '../../core/result'
import { cancelledIfDisposed } from '../../core/session'
import { isNonBlank, sessionTokensOf } from '../../core/tokens'
import { readCallOptions, type CallOptions } from '../../core/transport'
import * as ops from './operations'
import type { IssuedSession, IssueTokenRequest } from './types'

/** Options for the `token` module. */
export type TokenOptions = ModuleOptions

/** Options for `issueToken`. */
export interface IssueTokenOptions extends CallOptions {
  /**
   * The `playerId` from the login response.
   * The token response does not include it, so the caller passes it.
   * The SDK only shows it to the app through `session.playerId()`.
   * The server identifies the player from the token, so do not use this value for access decisions.
   */
  readonly playerId: string
}

/**
 * Registers the token module.
 * It exchanges the authorization code from a login API for tokens and starts the session.
 * Tokens stay in the session and never appear in results.
 * The app gets the access token only through `session.getAccessToken()`.
 * The `auth` module refreshes these tokens through its own `baseUrl`, so give `auth` and `token` the same `baseUrl`.
 */
export function token(options: TokenOptions = {}) {
  return definePrivilegedModule('token', HOSTS.core, options, ({ call, privileged, lifetime }) => ({
    /**
     * Exchanges an authorization code for tokens and starts the session.
     * Call it within 180 seconds of the login response.
     * An authorization code works only once.
     * On success the result has the `playerId` and the expiry time, but no tokens.
     *
     * The server can answer with these `outcome` codes:
     * `invalid_client`, `unsupported_grant_type`, `invalid_grant`, `invalid_grant_expired`,
     * `invalid_grant_code_challenge`, `invalid_grant_refresh_token`, `app_not_found`,
     * and `temporarily_unavailable`.
     * An `invalid_grant` code means the authorization code was already used or is invalid.
     * The player must log in again.
     * Only `temporarily_unavailable` can succeed on a retry.
     *
     * The result is a failure with `Aborted` when another login or a logout finishes while the request is in flight.
     * It is a failure with `Cancelled` when `dispose()` or `options.signal` stops the request. The session is not replaced in either case.
     * A cancelled request may still have reached the server, which then used the authorization code. Start a new login.
     * It is a failure with `Internal` when the response has no usable access token or refresh token.
     * The server has used the authorization code by then. Start a new login.
     *
     * @throws {AxylUsageError} When `options.playerId` is missing or blank, or `grantType` is not `authorization_code`.
     */
    issueToken: async (req: IssueTokenRequest, o: IssueTokenOptions) => {
      // Read each option once. A getter could return another value on a later read and skip the checks below.
      const playerId: unknown = o?.playerId
      // The authorization code works only once.
      // Stop before sending when there is no `playerId` to put in the session.
      if (!isNonBlank(playerId)) {
        throw new AxylUsageError('issueToken requires options.playerId from the login response.')
      }
      // Only the `authorization_code` grant is accepted.
      // The app never holds a refresh token, so it has nothing to send in a `refresh_token` grant.
      // The SDK refreshes the session itself.
      if (
        (req as { body?: { grantType?: unknown } } | undefined)?.body?.grantType !==
        'authorization_code'
      ) {
        throw new AxylUsageError('issueToken accepts only grantType "authorization_code".')
      }
      const opts = readCallOptions('issueToken', o)
      // The session generation at request time.
      // `establish` refuses it as `stale` when another login or logout completed in the meantime.
      // After `dispose()`, `establish` refuses as `disposed`, whatever the generation.
      const generation = privileged.session.generation()
      const r = await call(ops.issueToken, req, opts)
      if (r.kind !== 'success') return r
      // `dispose()` or `options.signal` can stop the call after the transport returned.
      // A stopped call ends as `Cancelled`, even when the response is broken. So check before the response shape.
      if (isStopped(lifetime, opts?.signal)) return refused('cancelled')
      // A failure decided after the response keeps the trace ID of that response.
      const trace: { traceId?: string } = r.traceId !== undefined ? { traceId: r.traceId } : {}
      // Check the response shape instead of trusting the server. Reject a token that is not a string.
      // A session without a refresh token cannot be renewed. The Unity SDK refuses such a session too.
      // The server always returns one for this grant, so its absence means the response is broken.
      const tokens = sessionTokensOf(r.data, () => privileged.now())
      if (tokens === 'noAccessToken') {
        return failure('Internal', 'Token response has no access token.', trace)
      }
      if (tokens === 'noRefreshToken') {
        return failure('Internal', 'Token response has no refresh token.', trace)
      }
      const { accessToken, refreshToken, expiresAt } = tokens
      // A defensive check right before the session is set. Only a clock adapter that stops the call
      // while the expiry time is computed can reach it, because there is no `await` since the first check.
      // The session itself refuses the commit after `dispose()`, so only the app's signal is checked here.
      if (opts?.signal?.aborted === true) return refused('cancelled')
      const committed = privileged.session.establish(
        {
          accessToken,
          refreshToken,
          playerId,
          expiresAt,
        },
        generation,
      )
      const cancelled = cancelledIfDisposed(committed)
      if (cancelled !== undefined) return cancelled
      if (committed === 'stale') {
        return failure('Aborted', 'Session changed while issuing tokens.', trace)
      }
      const success: { kind: 'success'; data: IssuedSession; traceId?: string } = {
        kind: 'success',
        data: { playerId, expiresAtMs: expiresAt },
        ...trace,
      }
      return success
    },
  }))
}

/** The API that the `token` module adds to the client. */
export type TokenModule = ReturnType<typeof token>
// `TokenResponse` is the server response that the session keeps. The app never receives it, so it is not exported.
export type { IssuedSession, IssueTokenRequest } from './types'
