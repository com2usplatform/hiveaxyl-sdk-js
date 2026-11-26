// The public types of sign-in with a provider, and the `WebAuthAdapter` that runs it.
import type { PopupOptions, UserCanceled } from './popup'
import type { Failure, Outcome, Success } from './result'

/**
 * The result of an OAuth 2.0 authorization code callback.
 * The SDK has already checked `state`. It returns no other parameter from the callback.
 */
export interface OAuthCallback {
  /** The provider's authorization code. Sensitive. Do not log or persist. */
  readonly code: string
  /** The `state` the SDK created for this sign-in. It matched the callback. */
  readonly state: string
}

/**
 * The result of a Steam OpenID 2.0 callback.
 * Pass both values to `auth.loginProvider` with `providerId: 'STEAM'`. The server verifies the assertion with Steam.
 */
export interface OpenIdCallback {
  /** The SteamID64 from `openid.claimed_id`. */
  readonly providerUserId: string
  /**
   * The callback query string exactly as Steam sent it, without `?` and without the fragment.
   * It is not decoded or rebuilt, because that would break the signature check. Sensitive. Do not log or persist.
   */
  readonly providerToken: string
}

/** The callback data for each sign-in protocol. */
export interface SignInCallbacks {
  readonly oauth: OAuthCallback
  readonly steamOpenId: OpenIdCallback
}

/**
 * The protocol the provider uses.
 * - `oauth`: OAuth 2.0 authorization code. The callback carries `code` and `state`.
 * - `steamOpenId`: Steam OpenID 2.0. The callback carries the signed `openid.*` parameters.
 */
export type SignInProtocol = keyof SignInCallbacks

/**
 * The result of a sign-in flow.
 * - `success`: the callback arrived and passed the checks. Read `data`.
 * - `outcome` (`user_canceled`): the player closed the window or cancelled at the provider.
 * - `failure`: the window could not open, the app cancelled, or the callback was unusable. Read `error`.
 */
export type SignInResult<T> = Success<T> | Outcome<UserCanceled> | Failure

/** The values the SDK created for one sign-in. Build the provider's authorization URL from them. */
export interface AuthorizationValues {
  /**
   * A new random `state` for this sign-in. Put it in the `state` parameter of an OAuth authorization URL.
   * The SDK accepts only a callback that carries this value.
   */
  readonly state: string
  /**
   * `redirectUri` with `state` added as a query parameter.
   * Use it as `openid.return_to` for Steam. The SDK accepts only a Steam callback whose `openid.return_to` equals it exactly.
   */
  readonly returnTo: string
}

/** A sign-in request for a popup or a redirect. */
export interface SignInRequest<P extends SignInProtocol = SignInProtocol> {
  /** The provider protocol. The default is `oauth`. */
  readonly protocol?: P
  /**
   * The URL of your callback page. It must be on the same origin as the game page.
   * Register the exact value with the provider. For OAuth it must not contain `#`.
   */
  readonly redirectUri: string
  /**
   * Returns the provider's authorization URL. The SDK calls it once, with a new `state`.
   * It must return an absolute `https:` URL. On `localhost`, `127.0.0.1` or `[::1]`, `http:` also works.
   */
  readonly authorizationUrl: (values: AuthorizationValues) => string
}

/**
 * A sign-in window opened in advance by `WebAuthAdapter.openPopup`.
 * Open it on the first line of a click handler, before any `await`.
 * Browsers open a window only during the click. Then call `signIn` once.
 */
export interface SignInPopup {
  /**
   * Sends the window to the provider and waits for the callback.
   * It takes the callback URL from two paths and ignores every other message:
   * - The main path is a window message from the window this SDK opened, from the origin of `redirectUri`.
   *   A string that is not a usable URL, or a URL that repeats `code`, `state` or `error` (for Steam, `state` or an `openid.*` key),
   *   ends the sign-in with a `failure` (`Internal`, `WebAuthCallbackURLParseFailed`).
   *   A URL without the `state` of this sign-in is ignored.
   * - The backup path is a `BroadcastChannel` on the same origin, named `hiveaxyl-webauth:` followed by `state`.
   *   Any page on the origin can post there. It ignores a string that is not a URL, a URL that repeats a parameter,
   *   and a URL without the `state` of this sign-in. A URL with that `state` ends the sign-in like the main path,
   *   including a `failure` when it has no code.
   *
   * When the window closes, it waits 250 ms for a callback that is already on its way, then returns `user_canceled`.
   * A `Cross-Origin-Opener-Policy` header on the game page or the provider page can cut the link to the window.
   * The window then looks closed at once, and the sign-in can end as `user_canceled`.
   * Use at most `same-origin-allow-popups` on the game page. If it still happens, sign in by moving the page instead.
   * A second call returns a `failure` (`FailedPrecondition`).
   */
  signIn(
    request: SignInRequest<'steamOpenId'> & { readonly protocol: 'steamOpenId' },
    options?: PopupOptions,
  ): Promise<SignInResult<OpenIdCallback>>
  signIn(
    request: SignInRequest<'oauth'>,
    options?: PopupOptions,
  ): Promise<SignInResult<OAuthCallback>>
  /**
   * Closes the window and ends the flow as `Cancelled`.
   * Call it when you do not go on to `signIn`, for example when preparing the sign-in failed.
   * Until the flow ends, no other sign-in popup can open.
   */
  close(): void
}

/** What the SDK restores after a redirect sign-in returns to the page. */
interface RedirectContext {
  /** The provider name you passed when the redirect started. */
  readonly provider: string
  /** The `redirectUri` you passed. Send it unchanged when you exchange an OAuth code. */
  readonly redirectUri: string
  /** The provider PKCE verifier you passed, if any. Sensitive. Do not log or persist. */
  readonly codeVerifier?: string
}

/** The result data of a redirect sign-in. `protocol` tells which callback fields it has. */
export type RedirectSignIn =
  | (OAuthCallback & RedirectContext & { readonly protocol: 'oauth' })
  | (OpenIdCallback & RedirectContext & { readonly protocol: 'steamOpenId' })

/** A sign-in request that moves the whole page to the provider. */
export interface RedirectSignInRequest<
  P extends SignInProtocol = SignInProtocol,
> extends SignInRequest<P> {
  /** A provider name that you get back after the page returns, such as `'GOOGLE'`. */
  readonly provider: string
  /**
   * The provider PKCE verifier, when the provider needs one for the code exchange.
   * It is kept in `sessionStorage` until the page returns, then removed at once.
   */
  readonly codeVerifier?: string
}

/**
 * Runs sign-in with a provider in a popup window or by moving the page.
 * It matches the WebAuth add-on of the Unity SDK.
 * Replace it through the `adapters` option of `createAxyl`, for example in tests.
 */
export interface WebAuthAdapter {
  /**
   * Opens a blank sign-in window and returns its handle. It never throws for browser reasons.
   * When the window cannot open, `signIn` returns the reason.
   * `lifetime` aborts on `dispose()`. The flow then ends as `Cancelled` and the window closes.
   */
  openPopup(lifetime: AbortSignal): SignInPopup
  /**
   * Saves the sign-in values in `sessionStorage` and moves the page to the provider.
   * Returns `undefined` once the page starts to move, or a `failure` when it cannot start.
   */
  startRedirect(request: RedirectSignInRequest): Failure | undefined
  /**
   * Finishes a redirect sign-in when the page loads.
   * Returns `null` when the page URL carries no sign-in callback.
   * Otherwise it takes the saved values out of `sessionStorage` at once and removes the callback parameters from the address bar.
   */
  completeRedirect(): SignInResult<RedirectSignIn> | null
}
