// Reading sign-in callbacks and the record a redirect sign-in keeps while the page is away. They touch no browser API.
import { isRecord, jsonParse, jsonStringify } from './json'
import { popupResult } from './popup'
import type { Failure } from './result'
import { parseUrl } from './url'
import type {
  OAuthCallback,
  OpenIdCallback,
  RedirectSignIn,
  SignInCallbacks,
  SignInProtocol,
  SignInRequest,
  SignInResult,
} from './webauth'

/** Loopback hosts where a sign-in URL may use `http:`, as for a secure context. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Returns the origin of `redirectUri` when it is the origin of the game page.
 * Returns `null` for a URL that does not parse, an opaque origin such as a custom scheme, or another origin.
 * An opaque origin is serialized as `"null"`, the same value a sandboxed frame reports, so accepting it would be unsafe.
 * For OAuth it also returns `null` when `redirectUri` has a fragment, even an empty one.
 * OAuth 2.0 does not allow a fragment in a redirection endpoint (RFC 6749, section 3.1.2).
 */
export function redirectOriginOf(
  redirectUri: string,
  pageOrigin: string,
  protocol: SignInProtocol = 'oauth',
): string | null {
  const url = parseUrl(redirectUri)
  if (url === null) return null
  if (protocol === 'oauth' && redirectUri.includes('#')) return null
  return url.origin !== 'null' && url.origin === pageOrigin ? url.origin : null
}

/**
 * Returns the URL to open for a sign-in, or `null` when it must not be opened.
 * Only `https:` is allowed, and `http:` on a loopback host. A `javascript:` or `data:` URL would run in a window that shares the game origin.
 */
export function signInUrlOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = parseUrl(raw)
  if (url === null) return null
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))
  return ok ? url.href : null
}

/** `redirectUri` with `state` set as a query parameter and without a fragment. It is the Steam `openid.return_to`. */
export function returnToOf(redirectUri: string, state: string): string {
  const url = new URL(redirectUri)
  url.searchParams.set('state', state)
  url.hash = ''
  return url.href
}

/** A sign-in that passed the checks, with the provider URL to open. */
export interface PreparedSignIn {
  readonly kind: 'ready'
  readonly protocol: SignInProtocol
  /** The origin of `redirectUri`. It is the origin of the game page. */
  readonly origin: string
  /** The new `state` of this sign-in. */
  readonly state: string
  /** The provider's authorization URL. */
  readonly url: string
  /** `redirectUri` as it was before `authorizationUrl` ran. The callback is checked against it. */
  readonly redirectUri: string
}

/**
 * The steps that a popup sign-in and a redirect sign-in share before the provider page opens.
 * It checks `redirectUri` against `pageOrigin`, creates `state` with `newState`, and asks the app for the authorization URL.
 * Returns a `failure` (`InvalidArgument`) when `redirectUri` is not on `pageOrigin`, or when the URL is not one the SDK opens.
 * An error that `authorizationUrl` throws is not caught, so the caller can clean up before it passes the error on.
 */
export function prepareSignIn(
  request: SignInRequest,
  pageOrigin: string,
  newState: () => string,
): PreparedSignIn | Failure {
  const protocol = request.protocol ?? 'oauth'
  const { redirectUri } = request
  const origin = redirectOriginOf(redirectUri, pageOrigin, protocol)
  if (origin === null) return popupResult.invalidRedirectUri()
  const state = newState()
  const url = signInUrlOf(
    request.authorizationUrl({ state, returnTo: returnToOf(redirectUri, state) }),
  )
  if (url === null) return popupResult.invalidUrl()
  return { kind: 'ready', protocol, origin, state, url, redirectUri }
}

/** OAuth callback parameters that must appear at most once (RFC 6749, section 3.1). */
const SINGLE_OAUTH_KEYS = ['code', 'state', 'error']

/**
 * `true` when a key that must be single appears more than once.
 * OAuth allows each of `code`, `state` and `error` once. OpenID 2.0 allows no repeated parameter in a message,
 * so for Steam every `openid.*` key and `state` must be single.
 */
function hasRepeatedKey(params: URLSearchParams, protocol: SignInProtocol): boolean {
  const seen = new Set<string>()
  for (const key of params.keys()) {
    const single =
      protocol === 'oauth'
        ? SINGLE_OAUTH_KEYS.includes(key)
        : key === 'state' || key.startsWith('openid.')
    if (!single) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/** Provider error codes that mean the player cancelled. */
const CANCEL_ERRORS = new Set(['access_denied', 'user_cancelled_authorize'])

/** SteamID64 in a Steam `openid.claimed_id`. */
const STEAM_CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{1,20})$/

/**
 * Where a callback URL came from.
 * - `opener`: a window message from the window this SDK opened, on the origin of `redirectUri`.
 *   A URL that does not parse or that repeats a parameter ends the sign-in, as in the Unity web runtime.
 * - `channel`: the same-origin `BroadcastChannel` backup path. Any page on the origin can post there,
 *   so a URL that does not parse, one that repeats a parameter, and one without the right `state` are ignored.
 *   A URL with the right `state` ends the sign-in, as on the `opener` path.
 */
export type CallbackPath = 'opener' | 'channel'

/** What a callback must match. */
interface ExpectedCallback<P extends SignInProtocol> {
  readonly protocol: P
  readonly state: string
  readonly redirectUri: string
}

/**
 * Reads a callback URL for one sign-in.
 * Returns `null` when the callback does not belong to this sign-in because its `state` differs or is missing.
 * A popup then keeps waiting.
 * On the `channel` path, a URL that does not parse or that repeats a parameter is also `null`.
 * Otherwise it returns the result that ends the sign-in:
 * - A URL that does not parse (on the `opener` path), or a callback with the right `state` but without a code,
 *   is a `failure` (`Internal`, `WebAuthCallbackURLParseFailed`).
 * - On the `opener` path, a callback that repeats `code`, `state` or `error`
 *   (or, for Steam, `state` or an `openid.*` key) is the same `failure`.
 *   The SDK checks `state` and reads the code itself, so it does not guess which copy is right.
 * - A Steam callback whose `openid.return_to` is not exactly the expected value,
 *   or that did not arrive at its `openid.return_to`, is the same `failure`.
 * - A provider cancellation (`error=access_denied`, `openid.mode=cancel`) is `user_canceled`.
 * - Another provider error is a `failure` (`Unknown`) with the provider's code in `externalCode`.
 * - Otherwise it is `success` with only the values the next API call needs.
 * The callback URL can hold a code, so it never goes into a message or a log.
 */
export function readCallback<P extends SignInProtocol>(
  callbackUrl: string,
  expected: ExpectedCallback<P>,
  path: CallbackPath = 'opener',
): SignInResult<SignInCallbacks[P]> | null {
  const url = parseUrl(callbackUrl)
  if (url === null) return path === 'opener' ? popupResult.callbackParseFailed() : null
  const q = url.searchParams
  if (hasRepeatedKey(q, expected.protocol)) {
    return path === 'opener' ? popupResult.callbackParseFailed() : null
  }
  if (q.get('state') !== expected.state) return null
  const result =
    expected.protocol === 'steamOpenId' ? readOpenId(url, expected) : readOAuth(q, expected.state)
  return result as SignInResult<SignInCallbacks[P]> | null
}

function readOAuth(q: URLSearchParams, state: string): SignInResult<OAuthCallback> {
  const error = q.get('error')
  if (error !== null) {
    return CANCEL_ERRORS.has(error) ? popupResult.userCanceled() : popupResult.providerError(error)
  }
  const code = q.get('code')
  if (!code) return popupResult.callbackParseFailed()
  return { kind: 'success', data: { code, state } }
}

function readOpenId(
  url: URL,
  expected: ExpectedCallback<SignInProtocol>,
): SignInResult<OpenIdCallback> {
  const q = url.searchParams
  const mode = q.get('openid.mode')
  if (mode === 'cancel') return popupResult.userCanceled()
  if (mode === null) return popupResult.callbackParseFailed()
  if (mode !== 'id_res') return popupResult.providerError(mode)
  const returnTo = returnToOf(expected.redirectUri, expected.state)
  if (q.get('openid.return_to') !== returnTo || !arrivedAt(url, new URL(returnTo))) {
    return popupResult.callbackParseFailed()
  }
  const steamId = STEAM_CLAIMED_ID.exec(q.get('openid.claimed_id') ?? '')?.[1]
  if (steamId === undefined) return popupResult.callbackParseFailed()
  return { kind: 'success', data: { providerUserId: steamId, providerToken: url.search.slice(1) } }
}

/**
 * `true` when `url` is the address that `returnTo` names, as OpenID 2.0 requires (section 11.1).
 * The scheme, host, port and path must be equal.
 * Every query parameter of `returnTo` must also be in `url` with the same value.
 */
function arrivedAt(url: URL, returnTo: URL): boolean {
  if (url.protocol !== returnTo.protocol || url.host !== returnTo.host) return false
  if (url.pathname !== returnTo.pathname) return false
  for (const [key, value] of returnTo.searchParams) {
    if (!url.searchParams.getAll(key).includes(value)) return false
  }
  return true
}

/** Query parameters that a sign-in callback adds to the page URL. */
const CALLBACK_KEYS = new Set(['code', 'state', 'error', 'error_description', 'error_uri', 'iss'])
const isCallbackKey = (key: string) => CALLBACK_KEYS.has(key) || key.startsWith('openid.')

/**
 * `true` when the page URL looks like a sign-in callback: it has `state` together with `code`, `error` or `openid.mode`.
 * A page address with only `code`, such as a coupon link, is not a callback.
 */
export function hasCallbackParams(href: string): boolean {
  const q = parseUrl(href)?.searchParams
  if (q === undefined) return false
  return q.has('state') && (q.has('code') || q.has('error') || q.has('openid.mode'))
}

/** The page URL without the callback parameters. Other parameters and the fragment stay. */
export function withoutCallbackParams(href: string): string {
  const url = new URL(href)
  // Collect the keys first. Deleting while iterating the live list would skip entries.
  const keys = Array.from(url.searchParams.keys()).filter(isCallbackKey)
  for (const key of keys) url.searchParams.delete(key)
  return url.href
}

/** The values saved in `sessionStorage` while the page is away at the provider. */
export interface RedirectRecord {
  readonly protocol: SignInProtocol
  readonly state: string
  readonly provider: string
  readonly redirectUri: string
  readonly codeVerifier?: string
}

const RECORD_VERSION = 1

export function encodeRedirectRecord(record: RedirectRecord): string {
  return jsonStringify({ v: RECORD_VERSION, ...record }) ?? ''
}

/** Reads a saved record. Returns `null` for a missing or malformed value, such as a `redirectUri` that is not a URL. */
export function decodeRedirectRecord(raw: string | null): RedirectRecord | null {
  if (raw === null) return null
  let value: unknown
  try {
    value = jsonParse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || value['v'] !== RECORD_VERSION) return null
  const { protocol, state, provider, redirectUri, codeVerifier } = value
  if (protocol !== 'oauth' && protocol !== 'steamOpenId') return null
  if (typeof state !== 'string' || state === '') return null
  if (typeof provider !== 'string' || typeof redirectUri !== 'string') return null
  if (parseUrl(redirectUri) === null) return null
  if (codeVerifier !== undefined && typeof codeVerifier !== 'string') return null
  return {
    protocol,
    state,
    provider,
    redirectUri,
    ...(codeVerifier !== undefined && { codeVerifier }),
  }
}

/**
 * Finishes a redirect sign-in from the page URL and the saved record.
 * A missing or damaged record, or a callback whose `state` does not match it,
 * is a `failure` (`FailedPrecondition`, `Auth_RedirectStateMissing`).
 */
export function completeRedirectFrom(
  href: string,
  saved: string | null,
): SignInResult<RedirectSignIn> {
  const record = decodeRedirectRecord(saved)
  if (record === null) return popupResult.redirectStateMissing()
  const r = readCallback(href, record)
  if (r === null) return popupResult.redirectStateMissing()
  if (r.kind !== 'success') return r
  const context = {
    provider: record.provider,
    redirectUri: record.redirectUri,
    ...(record.codeVerifier !== undefined && { codeVerifier: record.codeVerifier }),
  }
  const data: RedirectSignIn =
    record.protocol === 'steamOpenId'
      ? { protocol: 'steamOpenId', ...(r.data as OpenIdCallback), ...context }
      : { protocol: 'oauth', ...(r.data as OAuthCallback), ...context }
  return { kind: 'success', data }
}
