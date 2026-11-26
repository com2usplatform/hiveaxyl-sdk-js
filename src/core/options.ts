import { AxylUsageError } from './errors'
import { RETRY_POLICY, type RetryPolicy } from './retry'

/**
 * Retry and timeout settings. Omitted items use the defaults.
 * Token refresh requests are never retried, whatever these values are.
 * The refresh token rotates on every use, so a replay could sign the player out.
 */
export interface NetworkOptions {
  /**
   * Time limit of one request attempt in milliseconds. Default `30000`. Retry waits and refresh waits are not included.
   * An integer from `1` to `2147483647`.
   */
  readonly timeoutMs?: number
  /**
   * Maximum number of retries after the first attempt. Default `3`. An integer from `0` to `2147483647`.
   * A send after a 401 and a token refresh starts its own count, so one call can send up to 2 × (maxRetries + 1) requests.
   */
  readonly maxRetries?: number
  /**
   * Base delay of the exponential backoff in milliseconds. Default `1000`. An integer from `1` to `2147483647`.
   * Each wait is capped at 10 seconds plus up to 0.5 seconds of jitter, whatever this value is.
   */
  readonly backoffBaseMs?: number
  /**
   * Longest `Retry-After` wait in milliseconds that the SDK accepts before it retries. Default `60000`.
   * An integer from `1` to `2147483647`.
   * It applies only to a response that the SDK would send again: a 429, or a 500, 502, 503 or 504 for an idempotent request.
   * It also applies only while retries remain.
   * If such a response asks for a longer wait, the SDK does not retry.
   * The call then ends as a `failure` with `ResourceExhausted` and `Net_RateLimited`.
   * Otherwise a long `Retry-After` changes nothing, and the response is classified as usual.
   * The browser can read `Retry-After` only when the server exposes it through CORS.
   */
  readonly retryAfterMaxWaitMs?: number
}

/** Reads an own property of an options object. An inherited property counts as missing. */
export const own = <T>(o: object, key: string): T | undefined =>
  Object.hasOwn(o, key) ? ((o as Record<string, unknown>)[key] as T) : undefined

/** The largest delay `setTimeout` accepts. Browsers run longer timers immediately. */
const MAX_TIMER_MS = 2_147_483_647
/** The largest 32-bit integer. The Unity SDK keeps every network option in this range. */
const MAX_INT32 = 2_147_483_647

/**
 * The ranges match the Unity SDK.
 * The timeout, the backoff base and the `Retry-After` limit must be positive.
 */
const NETWORK_KEYS = {
  timeoutMs: { field: 'attemptTimeoutMs', min: 1, max: MAX_TIMER_MS },
  maxRetries: { field: 'maxRetries', min: 0, max: MAX_INT32 },
  backoffBaseMs: { field: 'baseDelayMs', min: 1, max: MAX_TIMER_MS },
  retryAfterMaxWaitMs: { field: 'retryAfterCapMs', min: 1, max: MAX_TIMER_MS },
} as const satisfies Record<
  keyof NetworkOptions,
  { field: keyof RetryPolicy; min: number; max: number }
>

/**
 * `true` for `{}` or `Object.create(null)`, not for an array, a `Date` or a class instance.
 * It also accepts `{}` made in another window, such as an iframe. That object has the other window's `Object.prototype`.
 */
function isPlainObject(value: object): boolean {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto === null || proto === Object.prototype) return true
  // Another window's `Object.prototype` has no prototype, and its own `constructor` is that window's `Object`.
  // A class prototype has a prototype, so a class instance stops here.
  if (typeof proto !== 'object' || Object.getPrototypeOf(proto) !== null) return false
  const ctor: unknown = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value
  return typeof ctor === 'function' && ctor.name === 'Object'
}

/** Applies the app's `network` over the core defaults. A non-integer or out-of-range value is an app code error. */
export function retryPolicyOf(network: unknown): RetryPolicy {
  if (network === undefined) return RETRY_POLICY
  // Only a plain object holds settings. An array or a `Date` has no keys, so it would silently mean "defaults".
  if (typeof network !== 'object' || network === null || !isPlainObject(network)) {
    throw new AxylUsageError('network must be an object, such as { timeoutMs: 10000 }.')
  }
  const policy: Record<string, number> = { ...RETRY_POLICY }
  for (const key of Object.keys(network)) {
    if (!Object.hasOwn(NETWORK_KEYS, key))
      throw new AxylUsageError(
        `network.${key} is not an option. Use timeoutMs, maxRetries, backoffBaseMs or retryAfterMaxWaitMs.`,
      )
    const rule = NETWORK_KEYS[key as keyof NetworkOptions]
    const value = own<unknown>(network, key)
    if (value === undefined) continue
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < rule.min ||
      value > rule.max
    ) {
      throw new AxylUsageError(`network.${key} must be an integer from ${rule.min} to ${rule.max}.`)
    }
    policy[rule.field] = value
  }
  return Object.freeze(policy) as unknown as RetryPolicy
}

/**
 * BCP 47 tag shape: a 2- or 3-letter language code, then subtags of letters or digits joined by `-`.
 * It is the same rule as the Unity SDK and is safe as a header value.
 */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

/** Returns the tag to send. `null` means the browser language, so it returns `undefined`. */
export function checkLanguage(language: unknown): string | undefined {
  if (language === null) return undefined
  if (typeof language !== 'string' || !LANGUAGE_TAG.test(language)) {
    throw new AxylUsageError(
      'language must be a BCP 47 tag such as "ko-KR". Pass null to use the browser language.',
    )
  }
  return language
}
