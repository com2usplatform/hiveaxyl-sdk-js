/**
 * The cause of a `failure` result.
 * The names match `HiveErrorCode` in the Hive Axyl Unity SDK.
 * The values are strings, not numbers, so logs and serialized results stay readable.
 *
 * - `Cancelled`: the app cancelled the call with `signal` or `dispose()`.
 * - `Unknown`: the server returned a 4xx status that has no specific mapping, or a sign-in provider returned an error.
 * - `InvalidArgument`: the request was invalid. The server returned 400 or 422, or the SDK rejected an argument before sending.
 * - `DeadlineExceeded`: the request ran out of time. The server may also have returned 504.
 * - `NotFound`: the server returned 404.
 * - `AlreadyExists`: the server returned 409.
 * - `PermissionDenied`: the server returned 403, or the request URL is not an allowed Hive Axyl server.
 * - `ResourceExhausted`: the server returned 429, its `Retry-After` asked for a longer wait than the limit,
 *   or too many requests are waiting for a token refresh.
 * - `FailedPrecondition`: the page cannot run the SDK. For example, it is not a secure context (`externalCode` is `Env_InsecureContext`).
 *   It also means that a sign-in or payment window flow is already running, or that the saved state of a redirect sign-in is missing.
 *   With `externalCode` `Auth_SessionChanged`, a sign-in, sign-out or session end happened while the call was running.
 *   The call was not sent with the new session's token.
 * - `Aborted`: the session changed while a sign-in was registering its tokens, or another sign-in or sign-out was still running. Sign in again.
 * - `OutOfRange`: a value was outside the allowed range.
 * - `Unimplemented`: the server returned 501.
 * - `Internal`: the server returned 500 or an unexpected status, the response could not be read,
 *   a sign-in callback URL could not be read, or a browser feature the SDK needs, such as Web Crypto, failed.
 * - `Unavailable`: the network or the server is unavailable. Check `externalCode` for the detail.
 * - `DataLoss`: data was lost or corrupted.
 * - `Unauthenticated`: the server returned 401. A call that waited for a token refresh also gets it
 *   when the server rejected the refresh token and the session ended. That call was not sent.
 */
export type HiveErrorCode =
  | 'Cancelled'
  | 'Unknown'
  | 'InvalidArgument'
  | 'DeadlineExceeded'
  | 'NotFound'
  | 'AlreadyExists'
  | 'PermissionDenied'
  | 'ResourceExhausted'
  | 'FailedPrecondition'
  | 'Aborted'
  | 'OutOfRange'
  | 'Unimplemented'
  | 'Internal'
  | 'Unavailable'
  | 'DataLoss'
  | 'Unauthenticated'

/**
 * Details of a `failure` result.
 * It has the fields of `HiveError` in the Hive Axyl Unity SDK, except `details`. This SDK never fills that value.
 */
export interface HiveError {
  /** The cause category. */
  readonly code: HiveErrorCode
  /** An English message for developers. Do not show it to players. */
  readonly message: string
  /**
   * A more specific error code.
   * It is the server's `code` when the server sent one.
   * Otherwise it is an SDK code such as `Net_Timeout`, `Net_Offline`, or `Net_RateLimited`,
   * or the HTTP status such as `HTTP 404` when the response had no `code`.
   * It is absent when no more specific code applies, such as for `Cancelled`.
   */
  readonly externalCode?: string
  /**
   * The W3C trace ID of the request (32 lowercase hex characters). Include it when you report a problem.
   * It is present when the SDK classified a server response.
   * It is absent when no response arrived, such as on a timeout, a network error or a cancel at any point.
   * It is also absent when a token refresh ended the call, when a session change between attempts ended it,
   * and when a `Retry-After` wait over the limit ended it.
   */
  readonly traceId?: string
  /** The problem type URI from an RFC 9457 error body. */
  readonly type?: string
  /** The problem instance URI from an RFC 9457 error body. */
  readonly instance?: string
}

/**
 * The 14 common error codes that most server specifications declare.
 * The analytics, coupon, mailbox, and payment specifications use this list.
 * Each specification declares its own list, so each operation lists its codes in `failures`.
 */
export const STANDARD_FAILURES: readonly string[] = Object.freeze([
  'bad_request',
  'invalid_parameter',
  'missing_field',
  'missing_app_id',
  'unauthorized',
  'token_expired',
  'forbidden',
  'resource_not_found',
  'method_not_allowed',
  'resource_conflict',
  'unprocessable_content',
  'rate_limit_exceeded',
  'internal_error',
  'service_unavailable',
])

/** The 3 common error codes that the auth and token specifications declare. */
export const AUTH_FAILURES: readonly string[] = Object.freeze([
  'invalid_parameter',
  'missing_field',
  'missing_app_id',
])

/**
 * Thrown when the app code uses the SDK incorrectly.
 * Examples are invalid options, a module that was not registered, and a call after `dispose()`.
 * Fix the app code when you see it.
 * Network, server, and browser problems do not throw. They return a `failure` result.
 */
export class AxylUsageError extends Error {
  override readonly name = 'AxylUsageError'
}
