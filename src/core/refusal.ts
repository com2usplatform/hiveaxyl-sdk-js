import { failure, type Failure } from './result'

/**
 * Why a request got no response: the browser was offline, the connection failed, or the attempt timed out.
 */
export type TransportFailure = 'offline' | 'network' | 'timeout'

/** Why an attempt ended without a response. A cancel is the only reason that is not a `TransportFailure`. */
export type NoResponse = TransportFailure | 'cancelled'

/**
 * The `externalCode` of each `TransportFailure`. The codes match the Unity SDK.
 * `refused` writes them, and `transportFailureOf` reads them back.
 */
const TRANSPORT_EXTERNAL_CODE: Readonly<Record<TransportFailure, string>> = Object.freeze({
  offline: 'Net_Offline',
  network: 'Net_ConnectionError',
  timeout: 'Net_Timeout',
})

export const isTransportFailure = (reason: string): reason is TransportFailure =>
  Object.hasOwn(TRANSPORT_EXTERNAL_CODE, reason)

/** The `TransportFailure` that a failure's `externalCode` stands for, or `undefined` for any other code. */
export function transportFailureOf(externalCode: string | undefined): TransportFailure | undefined {
  if (externalCode === undefined) return undefined
  return (Object.keys(TRANSPORT_EXTERNAL_CODE) as TransportFailure[]).find(
    (reason) => TRANSPORT_EXTERNAL_CODE[reason] === externalCode,
  )
}

/**
 * Reason why `Session.tokenForRequest` gives no token. Most names match the results of `refreshAfter401`.
 * `sessionExpired` is the one exception. A refresh result of `unauthenticated` becomes `sessionExpired` for a request that waited.
 * - `cancelled`: the request that waited for a refresh was cancelled. It leaves the queue at once.
 * - `exhausted`: the refresh queue is full.
 * - `failed`: the refresh it waited for failed without a verdict.
 *   The request still holds a token that got a 401, so it is not sent.
 *   Sending it would count one more failure without a verdict.
 * - `halted`: refreshes kept failing without a verdict and stopped. The session already ended.
 *   As in Unity SDK 1.0, every request that waited for that refresh gets `Auth_RefreshHalted`, unless it was cancelled.
 * - `sessionChanged`: a sign-in, sign-out or session end happened while it waited.
 *   A request from the old session is never sent with a token of the new session.
 * - `sessionExpired`: the server rejected the refresh token it waited for, and the session ended.
 * - `offline`, `network`, `timeout`: the refresh that started because the token expired got no response.
 *   The request is not sent and ends with the same failure as a request that got no response.
 */
export type TokenRefusal =
  | 'cancelled'
  | 'exhausted'
  | 'failed'
  | 'halted'
  | 'sessionChanged'
  | 'sessionExpired'
  | TransportFailure

/**
 * Turns a reason a call got no usable response into a `failure`.
 * The reason is a refusal from the token refresh, or an attempt that got no response.
 * Privileged modules use it too, so that a call they stop before sending returns the same result.
 */
export function refused(reason: TokenRefusal): Failure {
  switch (reason) {
    case 'cancelled':
      return failure('Cancelled', 'Request was cancelled.')
    case 'exhausted':
      return failure('ResourceExhausted', 'Token refresh queue is full.')
    case 'failed':
      return failure('Unavailable', 'Token refresh failed.')
    case 'halted':
      // Refreshes kept failing without a verdict, so the session ended. The code matches Unity SDK 1.0.
      return failure('Unavailable', 'Token refresh halted.', { externalCode: 'Auth_RefreshHalted' })
    case 'sessionChanged':
      // The request belongs to a sign-in that was replaced or ended. The Unity SDK 1.0 has no such code.
      return failure(
        'FailedPrecondition',
        'The login session changed before the request could complete.',
        {
          externalCode: 'Auth_SessionChanged',
        },
      )
    case 'sessionExpired':
      return failure('Unauthenticated', 'Session expired.')
    case 'offline':
      return failure('Unavailable', 'Network is offline.', {
        externalCode: TRANSPORT_EXTERNAL_CODE.offline,
      })
    case 'timeout':
      // The attempt ran past its own time limit. Retry waits do not count toward it.
      return failure('DeadlineExceeded', 'Request timed out.', {
        externalCode: TRANSPORT_EXTERNAL_CODE.timeout,
      })
    case 'network':
      // `fetch` does not tell why it failed. DNS, TLS, a dropped connection and a CORS block all count as connection errors.
      // A 404 for a path the gateway does not route has no CORS headers, so it lands here. The message names that possible cause.
      return failure(
        'Unavailable',
        'Network request failed. If the browser console shows a CORS error, check that the gateway routes this path.',
        { externalCode: TRANSPORT_EXTERNAL_CODE.network },
      )
  }
}
