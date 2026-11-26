import type { NoResponse } from './refusal'

/** Retry and timeout values. `Ms` in a name means milliseconds. */
export interface RetryPolicy {
  readonly maxRetries: number
  readonly attemptTimeoutMs: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly jitterMs: number
  readonly retryAfterCapMs: number
}

/**
 * The default retry values. Every Hive Axyl SDK uses the same values.
 * The app can change `maxRetries`, `attemptTimeoutMs`, `baseDelayMs` and `retryAfterCapMs`
 * through `createAxyl({ network })`. `maxDelayMs` and `jitterMs` are fixed.
 */
export const RETRY_POLICY: RetryPolicy = Object.freeze({
  maxRetries: 3,
  attemptTimeoutMs: 30_000,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
  jitterMs: 500,
  retryAfterCapMs: 60_000,
})

/** How one attempt ended. The transport creates it and passes it to the retry decision. */
export type SendOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly retryAfter?: string | null }
  | { readonly kind: NoResponse }

const RETRYABLE_5XX = new Set([500, 502, 503, 504])

/** `retryDelay` returns it when `Retry-After` asks for a longer wait than the cap. The transport then ends with `ResourceExhausted`. */
export const RETRY_AFTER_TOO_LONG = 'retryAfterTooLong'

/**
 * Returns how long to wait before the next attempt, in milliseconds. Returns `null` when the request is not sent again.
 * - 429 is always retried.
 * - Connection errors, timeouts, and 500, 502, 503, and 504 are retried only for idempotent requests.
 * - Offline and cancelled attempts are not retried. The transport filters out business results first, whatever their status.
 * - A `Retry-After` value in the response sets the wait. A wait above `retryAfterCapMs` (60 seconds by default)
 *   returns `RETRY_AFTER_TOO_LONG` and is not retried.
 */
export function retryDelay(
  outcome: SendOutcome,
  idempotent: boolean,
  attemptIndex: number,
  random: () => number,
  nowMs: () => number = Date.now,
  policy: RetryPolicy = RETRY_POLICY,
): number | null | typeof RETRY_AFTER_TOO_LONG {
  if (attemptIndex >= policy.maxRetries) return null

  switch (outcome.kind) {
    case 'offline':
    case 'cancelled':
      return null
    case 'network':
    case 'timeout':
      return idempotent ? backoff(attemptIndex, random, policy) : null
    case 'response': {
      if (outcome.status !== 429 && !(RETRYABLE_5XX.has(outcome.status) && idempotent)) return null
      const wait = parseRetryAfter(outcome.retryAfter, nowMs)
      if (wait === null) return backoff(attemptIndex, random, policy)
      return wait > policy.retryAfterCapMs ? RETRY_AFTER_TOO_LONG : wait
    }
  }
}

export function backoff(
  attemptIndex: number,
  random: () => number,
  policy: RetryPolicy = RETRY_POLICY,
): number {
  const exp = Math.min(policy.baseDelayMs * 2 ** attemptIndex, policy.maxDelayMs)
  return exp + Math.floor(random() * policy.jitterMs)
}

const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/

/**
 * Converts `Retry-After` to milliseconds. `retryDelay` applies the cap.
 * It reads whole seconds or an HTTP date, as the Unity SDK does. A date in the past means no wait.
 * Any other value is ignored, and the default backoff applies.
 * The browser can read this header only when the server exposes it through CORS.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: () => number,
): number | null {
  if (value == null || value.trim() === '') return null
  if (/^[0-9]+$/.test(value)) return Number(value) * 1000
  // Only the HTTP date form, for example `Sun, 06 Nov 1994 08:49:37 GMT`. `Date.parse` alone accepts far more.
  if (!HTTP_DATE.test(value)) return null
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - nowMs())
}
