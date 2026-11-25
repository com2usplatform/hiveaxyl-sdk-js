import { createBrowserPopup, createPaymentWindow } from '../../browser/payment'
import { AxylUsageError } from '../../core/errors'
import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type * as T from './types'

/** Options for the `payment` module. */
export interface PaymentOptions extends ModuleOptions {
  /** Uses the sandbox server. Same as `AddPayments(sandbox: true)` in the Unity SDK. */
  readonly sandbox?: boolean
}

/**
 * Registers the payment module. The web pays through PG.
 * The SDK does not confirm that a payment succeeded.
 * The app server verifies the receipt and confirms it.
 * It verifies with the paying player's access token, not with server credentials.
 * The player must be logged in.
 *
 * Each API can answer with the `outcome` codes `payment_bad_request` and `payment_invalid_parameter`.
 * Other codes are listed on each method.
 * The `data` of an `outcome` has the shape `{ code: number, message: string, detailCode?: number }`.
 * `code` is a number that the payment service defines. `message` is fixed text that identifies it, not text for players.
 * Codes this SDK version does not list arrive as `unknownOutcome`.
 *
 * @throws {AxylUsageError} When both `baseUrl` and `sandbox` are given.
 *
 * @example
 * createAxyl({ appId, clientId, modules: { auth: auth(), token: token(), payment: payment({ sandbox: true }) } })
 */
export function payment(options: PaymentOptions = {}) {
  if (options.baseUrl !== undefined && options.sandbox !== undefined) {
    throw new AxylUsageError('payment accepts either baseUrl or sandbox, not both.')
  }
  const host = options.sandbox ? HOSTS.commerceSandbox : HOSTS.commerce
  return defineModule('payment', host, options, ({ call, ...ctx }) => ({
    /**
     * Opens a blank payment window and returns its handle.
     * Call it on the first line of a click handler, before any `await`. Browsers open a window only during the click.
     * Then get `payUrl` from `createPaymentUrl` and call `show(payUrl)` on the handle.
     * If you do not call `show`, call `close()`. It also opens in in-app browsers, when the browser allows it.
     *
     * `show` cuts `opener`, opens only `https:` URLs, and resolves when the window closes:
     * - `closed`: the window closed. It does not mean the purchase succeeded. Check with `restorePurchases`,
     *   and let your game server verify the receipt. A page can look closed early, so check again later too.
     * - `failure` with `Unavailable` and `externalCode` `WebAuthPopupBlocked`: the browser blocked the window.
     *   Ask the player to retry from a click, or to allow popups. Payments have no redirect fallback.
     *   In a portal iframe, the portal's `sandbox` or opener policy can also block it, and allowing popups does not help.
     *   Ask the player to open the game outside the portal.
     * - `failure` with `Unavailable` and no `externalCode`: the browser did not let the window move to `payUrl`.
     *   Nothing was paid in this window. Ask the player to retry from a click.
     * - `failure` with `InvalidArgument`: `payUrl` is not an `https:` URL.
     * - `failure` with `Cancelled`: `signal`, `close()` or `dispose()` ended it. The window closes, unless the browser cut the link to it.
     *   In Chromium and WebKit browsers it also stays open once it has moved to the payment page. `show` cut its `opener`, and these browsers ignore `close()` on such a window.
     *   The player can still pay there. Check again later with `restorePurchases`, for example when the player returns to the game.
     *
     * @example
     * buyButton.onclick = async () => {
     *   const win = axyl.payment.openPaymentWindow() // first line, before any await
     *   const url = await axyl.payment.createPaymentUrl(request)
     *   if (url.kind !== 'success') return win.close()
     *   if (!url.data.payUrl) return win.close() // the response has no payment page URL
     *   await win.show(url.data.payUrl)
     *   await checkPurchases() // restorePurchases, then your game server
     * }
     */
    openPaymentWindow: () =>
      createPaymentWindow(ctx.feature('popup', createBrowserPopup), ctx.lifetime),
    /** Gets the PG product list with prices in the requested currency. */
    fetchPgProducts: (req: T.FetchPgProductsRequest, o?: CallOptions) =>
      call(ops.fetchPgProducts, req, o),
    /**
     * Records the purchase attempt just before the payment page opens.
     * A later restore uses this record to find the stored payload.
     * This step is optional. Skip it and a restore has no stored payload to return.
     */
    createPrePurchase: (req: T.CreatePrePurchaseRequest, o?: CallOptions) =>
      call(ops.createPrePurchase, req, o),
    /**
     * Creates the URL of the PG payment page.
     * Open the returned `payUrl` with `PaymentWindow.show`. If your code opens it some other way, open it only when it starts with `https:`.
     * `PaymentWindow.show` opens only `https:` URLs. It returns a `failure` (`InvalidArgument`) for any other URL.
     * The URL works only until the order expires.
     */
    createPaymentUrl: (req: T.CreatePaymentUrlRequest, o?: CallOptions) =>
      call(ops.createPaymentUrl, req, o),
    /**
     * Stores the payment result on the server after the payment completes.
     * For PG, call it after `restorePurchases` returns the `axylReceipt`.
     * It keeps a record of the payment before the app server verifies the receipt.
     * The record remains even if a later step is interrupted.
     *
     * In addition to the common codes, the server can answer with
     * `payment_resource_not_found`, `payment_unauthorized`, and `verify_error`.
     */
    recordStorePurchase: (req: T.RecordStorePurchaseRequest, o?: CallOptions) =>
      call(ops.recordStorePurchase, req, o),
    /**
     * Completes the PG purchase and closes the transaction.
     * Always call it after the app server has verified the receipt and granted the items, as the Unity SDK example does.
     * A `success` result only closes the transaction. It does not confirm the payment.
     *
     * In addition to the common codes, the server can answer with `payment_resource_not_found`.
     */
    finalizePurchase: (req: T.FinalizePurchaseRequest, o?: CallOptions) =>
      call(ops.finalizePurchase, req, o),
    /**
     * Finds earlier purchases whose items were not granted.
     * Use it to grant items that a network failure left out.
     *
     * In addition to the common codes, the server can answer with `payment_resource_not_found`.
     */
    restorePurchases: (req: T.RestorePurchasesRequest, o?: CallOptions) =>
      call(ops.restorePurchases, req, o),
    /** Gets the product IDs registered for the app, grouped by store. */
    listStoreProductIds: (req: T.ListStoreProductIdsRequest, o?: CallOptions) =>
      call(ops.listStoreProductIds, req, o),
    /**
     * Closes the transaction after the game server has granted the items.
     * A `success` result only closes the transaction. It does not confirm the payment.
     * The PG payment flow uses `finalizePurchase` for this step.
     *
     * In addition to the common codes, the server can answer with
     * `payment_resource_not_found`, `payment_unauthorized`, `verify_duplicated`, and `verify_error`.
     */
    requestPurchase: (req: T.RequestPurchaseRequest, o?: CallOptions) =>
      call(ops.requestPurchase, req, o),
    /**
     * Records the result of granting consumable items and closes the transaction.
     * Call it only after the game server has granted the items, or has cancelled the grant.
     * A `success` result only records that result. It does not confirm the payment.
     *
     * In addition to the common codes, the server can answer with
     * `payment_resource_not_found`, `invalid_quantity`, and `invalid_status`.
     */
    itemResult: (req: T.ItemResultRequest, o?: CallOptions) => call(ops.itemResult, req, o),
    /**
     * Stores the product and the payload before a subscription purchase starts.
     * The SDK provides the three subscription APIs as plain calls. It has no subscription purchase flow for the web.
     *
     * In addition to the common codes, the server can answer with `payment_resource_not_found`.
     */
    prepareSubscription: (req: T.PrepareSubscriptionRequest, o?: CallOptions) =>
      call(ops.prepareSubscription, req, o),
    /**
     * Gets the purchase information of a subscription from its receipt.
     * The response carries the IDs of the subscription record that the server keeps.
     * The SDK has no subscription purchase flow for the web.
     *
     * In addition to the common codes, the server can answer with
     * `payment_resource_conflict`, `payment_resource_not_found`, `payment_unauthorized`, and `verify_error`.
     */
    purchaseSubscription: (req: T.PurchaseSubscriptionRequest, o?: CallOptions) =>
      call(ops.purchaseSubscription, req, o),
    /**
     * Closes a subscription transaction.
     * A `success` result can still mean that nothing was closed. Check `hiveAxylTransactionId` in the response.
     * The SDK has no subscription purchase flow for the web.
     *
     * In addition to the common codes, the server can answer with
     * `payment_resource_not_found`, `payment_unauthorized`, `verify_duplicated`, and `verify_error`.
     */
    postSubscription: (req: T.PostSubscriptionRequest, o?: CallOptions) =>
      call(ops.postSubscription, req, o),
  }))
}

/** The API that the `payment` module adds to the client. */
export type PaymentModule = ReturnType<typeof payment>
export type * from './types'
export type { PaymentWindow, PaymentWindowResult, PopupOptions } from '../../core/popup'
