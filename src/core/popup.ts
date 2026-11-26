import { cut, failure, type Failure, type Outcome } from './result'

/**
 * The player closed the popup.
 * It means the same as `IUserCanceledOutcome` in the Unity SDK. The code matches the Unity web runtime.
 */
export const USER_CANCELED = 'user_canceled'
/** The `outcome` code returned when the player closes the popup. */
export type UserCanceled = typeof USER_CANCELED

/**
 * The results that end a popup sign-in or payment flow. They follow the same branches as Unity web auth.
 * The browser adapters and the callback reader create results only here, so every flow returns the same codes.
 * New values may be added. Handle unknown values in a default branch.
 */
export const popupResult = Object.freeze({
  /** The player closed the window. A closed window is only a hint, so this comes after a short wait for the callback. */
  userCanceled: (): Outcome<UserCanceled> => ({ kind: 'outcome', code: USER_CANCELED }),
  /**
   * The browser blocked the window. The code and message match the Unity web runtime.
   * A sign-in flow can continue with a full-page redirect. The payment window returns `paymentWindowResult.blocked`.
   */
  blocked: (): Failure =>
    failure(
      'Unavailable',
      'The browser blocked the web auth popup. Retry from a user gesture or allow popups for this site.',
      { externalCode: 'WebAuthPopupBlocked' },
    ),
  /**
   * The app cancelled with `signal` or `dispose()`.
   * A popup flow has no time limit of its own, as in the Unity SDK. To limit the wait, abort `signal` from a timer.
   */
  cancelled: (): Failure => failure('Cancelled', 'Popup flow was cancelled.'),
  /** Another sign-in is still running. Only one runs at a time, as in the Unity SDK. */
  inProgress: (): Failure =>
    failure(
      'FailedPrecondition',
      'A web auth session is already in progress. Only one can run at a time.',
    ),
  /** `redirectUri` is not an absolute URL on the origin of the game page. */
  invalidRedirectUri: (): Failure =>
    failure(
      'InvalidArgument',
      'redirectUri must be an absolute URL on the same origin as the game page.',
    ),
  /**
   * The URL to open is not an `https:` URL.
   * A sign-in URL on `localhost`, `127.0.0.1` or `[::1]` may also use `http:`.
   */
  invalidUrl: (): Failure =>
    failure('InvalidArgument', 'The URL to open must be an absolute https: URL.'),
  /** The callback page sent a value that is not a usable callback URL. The code matches the Unity web runtime. */
  callbackParseFailed: (): Failure =>
    failure('Internal', 'Failed to parse the captured callback URL.', {
      externalCode: 'WebAuthCallbackURLParseFailed',
    }),
  /**
   * The page came back from a redirect sign-in, but the values saved before it left are missing or do not match.
   * Session storage may be blocked, or the sign-in started in another tab or browser. Start the sign-in again.
   */
  redirectStateMissing: (): Failure =>
    failure(
      'FailedPrecondition',
      'The saved state for this redirect sign-in is missing. Start the sign-in again in this tab.',
      { externalCode: 'Auth_RedirectStateMissing' },
    ),
  /**
   * The browser did not let the page or the sign-in window move to the sign-in page.
   * A redirect sign-in and a popup sign-in both return it. The URL was checked before the move,
   * so the cause is the browser environment. The code is the same as `paymentWindowResult.notMoved`.
   */
  redirectNotMoved: (): Failure =>
    failure('Unavailable', 'The browser did not let the sign-in page open. Retry from a click.'),
  /**
   * The provider answered with an error other than a cancellation. `externalCode` holds the provider's code as sent.
   * A code longer than 256 characters is cut the same way as server text.
   */
  providerError: (code: string): Failure =>
    failure('Unknown', 'The provider returned an error to the sign-in callback.', {
      externalCode: cut(code),
    }),
})

/**
 * The results that only the payment window returns. Their codes are the same as in `popupResult`,
 * so one branch handles both windows. Only the message names the payment window.
 */
export const paymentWindowResult = Object.freeze({
  /**
   * The browser blocked the payment window. The code is the same as `popupResult.blocked`.
   * Ask the player to retry from a click, or to allow popups for this site.
   */
  blocked: (): Failure =>
    failure(
      'Unavailable',
      'The browser blocked the payment window. Retry from a user gesture or allow popups for this site.',
      { externalCode: 'WebAuthPopupBlocked' },
    ),
  /**
   * The window is open, but the browser did not let it move to `payUrl`.
   * The payment page did not open, so nothing was paid in this window. Ask the player to retry from a click.
   */
  notMoved: (): Failure =>
    failure(
      'Unavailable',
      'The payment window could not move to the payment page. Retry from a click.',
    ),
  /** The payment window already shows a payment. One window runs one payment. */
  inProgress: (): Failure =>
    failure(
      'FailedPrecondition',
      'This payment window is already in use. Open a new window for another payment.',
    ),
})

/** Options for a popup flow. */
export interface PopupOptions {
  /**
   * Stops waiting. The flow ends with a `failure` (`Cancelled`) and the SDK closes the window, unless the browser cut the link to it.
   * A popup flow has no time limit of its own. Pass `AbortSignal.timeout(ms)` to set one.
   * Safari before 16 lacks `AbortSignal.timeout`. There, abort an `AbortController` from `setTimeout`.
   * A payment window stays open in Chromium and WebKit once it has moved to the payment page. See `PaymentWindow.close`.
   */
  readonly signal?: AbortSignal
}

/**
 * The payment window result. The SDK reports only that the window closed.
 * It never says whether the purchase succeeded. Check it with `payment.restorePurchases` and your game server.
 */
export type PaymentWindowResult = { readonly kind: 'closed' } | Failure

/**
 * A payment window opened in advance.
 * Get it from `payment.openPaymentWindow()` on the first line of a click handler, before any `await`.
 */
export interface PaymentWindow {
  /**
   * Moves the window to `payUrl` and waits until it closes.
   * It cuts `opener` first, so the payment page cannot reach the game page. It opens only `https:` URLs.
   * A closed window is a hint. A page with a `Cross-Origin-Opener-Policy` header can look closed while it is open.
   * A second call returns a `failure` (`FailedPrecondition`).
   */
  show(payUrl: string, options?: PopupOptions): Promise<PaymentWindowResult>
  /**
   * Closes the window. A `show` that is waiting ends as `Cancelled`.
   * In Chromium and WebKit the window stays open once it has moved to the payment page, because its `opener` was cut.
   */
  close(): void
}
