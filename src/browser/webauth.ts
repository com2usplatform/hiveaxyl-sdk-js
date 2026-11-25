import {
  completeRedirectFrom,
  encodeRedirectRecord,
  hasCallbackParams,
  prepareSignIn,
  readCallback,
  withoutCallbackParams,
  type CallbackPath,
  type PreparedSignIn,
} from '../core/callback'
import { base64url } from '../core/encoding'
import { popupResult } from '../core/popup'
import type { Failure } from '../core/result'
import type { SignInPopup, SignInRequest, SignInResult, WebAuthAdapter } from '../core/webauth'
import { inAppBrowserOf, userAgent } from './environment'
import { STORAGE_KEY_PREFIX } from './storage'
import { openWindow, watchClosed, windowFlow } from './window'

/**
 * How long a closed sign-in window still waits for its callback.
 * The callback page posts the callback and then closes itself. The check that sees the window closed can run before
 * the message arrives, so an already sent callback wins over `user_canceled`. The value matches the Unity web runtime.
 */
const CLOSED_GRACE_MS = 250
/**
 * The `BroadcastChannel` name for one sign-in: this prefix followed by its `state`.
 * The callback page posts on the channel named for the `state` in its own URL.
 * Only the sign-in waiting for that `state` listens there.
 */
export const WEB_AUTH_CHANNEL_PREFIX = 'hiveaxyl-webauth:'
/** The `sessionStorage` key for a redirect sign-in. It holds no token. */
const REDIRECT_KEY = `${STORAGE_KEY_PREFIX}webauth`

/** A handle whose flow ended before it started, such as a blocked window. */
function endedPopup(result: SignInResult<never>): SignInPopup {
  return {
    signIn: () => Promise.resolve(result),
    close: () => {},
  } as SignInPopup
}

/** A new random `state`: 32 bytes in base64url. */
const newState = () => base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)))

/**
 * The browser default of the web auth adapter. It follows the WebAuth add-on of the Unity web runtime.
 * The `auth` module loads it unless the app passes its own `webAuth` adapter.
 * Apps reach it through `auth.openSignInPopup`, `auth.startRedirectSignIn` and `auth.completeRedirectSignIn`.
 * - Only one sign-in runs at a time.
 * - The sign-in window opens with the `popup` feature and keeps `opener`, so the callback page can post back.
 * - The main callback path is a window message. It counts only when it passes every check:
 *   the origin of `redirectUri`, the window this SDK opened, a string, and the `state` of this sign-in.
 * - The backup path is a same-origin `BroadcastChannel` named `hiveaxyl-webauth:` followed by `state`.
 *   It accepts only a URL with that `state`, and it ignores anything that does not parse.
 * - The window is checked every 500 ms. A closed window ends the sign-in as `user_canceled` after 250 ms.
 *   A `Cross-Origin-Opener-Policy` header on the game page or the provider page can cut the link to the window.
 *   The window then looks closed at once, and the sign-in can end as `user_canceled`.
 *   Use at most `same-origin-allow-popups` on the game page. If it still happens, use `auth.startRedirectSignIn`.
 * - There is no time limit. `signal` and `dispose()` end it as `Cancelled` and close the window.
 * - In a known in-app browser the sign-in window does not open. The result is the same as a blocked popup.
 */
export function createBrowserWebAuth(): WebAuthAdapter {
  let busy = false

  function openPopup(lifetime: AbortSignal): SignInPopup {
    if (busy) return endedPopup(popupResult.inProgress())
    if (inAppBrowserOf(userAgent()) !== null) {
      return endedPopup(popupResult.blocked())
    }
    // The `popup` feature asks for a separate window, as in the Unity web runtime. Browsers without it open a tab.
    const opened = openWindow('', '_blank', 'popup')
    if (!opened) return endedPopup(popupResult.blocked())
    const w: WindowProxy = opened
    busy = true
    const flow = windowFlow<SignInResult<unknown>>(w, () => (busy = false))
    flow.abortWith(lifetime, popupResult.cancelled)
    flow.onSettle(watchClosed(w, CLOSED_GRACE_MS, () => flow.settle(popupResult.userCanceled())))

    async function signIn(request: SignInRequest, options?: { readonly signal?: AbortSignal }) {
      const early = flow.start(options?.signal, popupResult.inProgress, popupResult.cancelled)
      if (early !== undefined) return early
      let prepared: PreparedSignIn | Failure
      try {
        prepared = prepareSignIn(request, globalThis.location.origin, newState)
      } catch (err) {
        // An error in app code is the app's to fix. Close the window first so another sign-in can start.
        flow.settle(popupResult.cancelled())
        throw err
      }
      // `authorizationUrl` may have closed or cancelled the flow. Then the window must not go to the provider.
      if (flow.result !== undefined) return flow.result
      if (prepared.kind === 'failure') {
        flow.settle(prepared)
        return flow.wait()
      }
      const { origin, url } = prepared
      const expected = {
        protocol: prepared.protocol,
        state: prepared.state,
        redirectUri: prepared.redirectUri,
      }

      const accept = (data: unknown, path: CallbackPath) => {
        if (typeof data !== 'string') return
        const r = readCallback(data, expected, path)
        if (r !== null) flow.settle(r)
      }
      const onMessage = (e: MessageEvent) => {
        if (e.origin === origin && e.source === w) accept(e.data, 'opener')
      }
      globalThis.addEventListener('message', onMessage)
      flow.onSettle(() => globalThis.removeEventListener('message', onMessage))
      try {
        const channel = new BroadcastChannel(WEB_AUTH_CHANNEL_PREFIX + expected.state)
        channel.onmessage = (e) => accept(e.data, 'channel')
        flow.onSettle(() => channel.close())
      } catch {
        // Without BroadcastChannel the window message still works.
      }

      try {
        w.location.replace(url)
      } catch {
        // A window that is already closed means the player closed it.
        // Otherwise the browser did not let the window move. The URL was checked before.
        flow.settle(w.closed ? popupResult.userCanceled() : popupResult.redirectNotMoved())
      }
      return flow.wait()
    }

    return { signIn, close: () => flow.settle(popupResult.cancelled()) } as SignInPopup
  }

  return {
    openPopup,
    startRedirect(request) {
      if (busy) return popupResult.inProgress()
      const prepared = prepareSignIn(request, globalThis.location.origin, newState)
      if (prepared.kind === 'failure') return prepared
      const record = encodeRedirectRecord({
        protocol: prepared.protocol,
        state: prepared.state,
        provider: request.provider,
        redirectUri: prepared.redirectUri,
        ...(request.codeVerifier !== undefined && { codeVerifier: request.codeVerifier }),
      })
      // Without the saved values the sign-in cannot finish after the page returns, so it does not leave.
      try {
        globalThis.sessionStorage.setItem(REDIRECT_KEY, record)
      } catch {
        return popupResult.redirectStateMissing()
      }
      try {
        globalThis.location.assign(prepared.url)
      } catch {
        // The browser did not let the page move. The saved values must not finish a later sign-in.
        try {
          globalThis.sessionStorage.removeItem(REDIRECT_KEY)
        } catch {
          // The next start overwrites them, and a return checks `state`.
        }
        return popupResult.redirectNotMoved()
      }
      return undefined
    },
    completeRedirect() {
      const href = globalThis.location.href
      if (!hasCallbackParams(href)) return null
      // Take the saved values out at once. A reload or a second call then cannot use them again.
      // If they cannot be removed, they are not used: they could be used a second time.
      let saved: string | null = null
      try {
        const storage = globalThis.sessionStorage
        const read = storage.getItem(REDIRECT_KEY)
        storage.removeItem(REDIRECT_KEY)
        saved = read
      } catch {
        // Blocked storage reads as missing values.
      }
      // Remove the code and `state` from the address bar and the history entry.
      try {
        globalThis.history.replaceState(globalThis.history.state, '', withoutCallbackParams(href))
      } catch {
        // The result does not depend on the address bar.
      }
      return completeRedirectFrom(href, saved)
    },
  }
}
