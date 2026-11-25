import type { PopupAdapter } from '../core/adapters'
import {
  paymentWindowResult,
  popupResult,
  type PaymentWindow,
  type PaymentWindowResult,
} from '../core/popup'
import { parseUrl } from '../core/url'
import { openWindow, watchClosed, windowFlow } from './window'

/**
 * Popups based on `window.open`. The payment window uses it.
 * The blank window opens without `noopener`.
 * With `noopener`, `window.open` returns no window object, so the URL could not be changed later.
 * Instead, `opener` is cleared before the window moves to its URL.
 */
export function createBrowserPopup(): PopupAdapter {
  return {
    openBlank() {
      const w = openWindow('', '_blank')
      if (!w) return null
      return {
        navigate(url) {
          const target = parseUrl(url)
          if (target === null) return false
          if (target.protocol !== 'https:' || w.closed) return false
          // A window that has already moved to another origin throws when `opener` is changed.
          try {
            w.opener = null
            w.location.replace(target.href)
          } catch {
            return false
          }
          return true
        },
        close: () => w.close(),
        looksClosed: () => w.closed,
      }
    },
  }
}

/**
 * Opens a blank payment window and returns its handle. `payment.openPaymentWindow()` returns this handle.
 * Call it during a click. Browsers block a window that opens outside a user gesture.
 * It does not check for in-app browsers. A payment window opens wherever the browser allows it.
 * `lifetime` aborts on `dispose()`. A waiting `show` then ends as `Cancelled` and the window closes.
 * In Chromium and WebKit the window stays open once it has moved to the payment page, because its `opener` was cut.
 */
export function createPaymentWindow(popup: PopupAdapter, lifetime: AbortSignal): PaymentWindow {
  const w = popup.openBlank()
  // A window that is already closed when it opens counts as blocked. Some popup blockers return such a window instead of `null`.
  if (!w || w.looksClosed()) {
    // `looksClosed()` is a hint. Close the window in case it is open, so no blank window is left behind.
    try {
      w?.close()
    } catch {
      // An app adapter's `close` may throw. The result is the same.
    }
    return { show: () => Promise.resolve(paymentWindowResult.blocked()), close: () => {} }
  }
  const view = {
    get closed() {
      return w.looksClosed()
    },
    close: () => w.close(),
  }
  const flow = windowFlow<PaymentWindowResult>(view, () => {})
  flow.abortWith(lifetime, popupResult.cancelled)
  return {
    show(payUrl, options) {
      const early = flow.start(
        options?.signal,
        paymentWindowResult.inProgress,
        popupResult.cancelled,
      )
      if (early !== undefined) return Promise.resolve(early)
      // Check the URL here, so a window that cannot move is not reported as a bad URL. An app adapter may not check it.
      const target = typeof payUrl === 'string' ? parseUrl(payUrl) : null
      if (target === null || target.protocol !== 'https:') {
        flow.settle(popupResult.invalidUrl())
        return flow.wait()
      }
      if (!w.navigate(payUrl)) {
        // A window that is already closed means the player closed it. Otherwise the browser did not let it move.
        flow.settle(w.looksClosed() ? { kind: 'closed' } : paymentWindowResult.notMoved())
        return flow.wait()
      }
      // A payment window sends no callback, so there is nothing to wait for after it closes.
      flow.onSettle(watchClosed(view, 0, () => flow.settle({ kind: 'closed' })))
      return flow.wait()
    },
    close: () => flow.settle(popupResult.cancelled()),
  }
}
