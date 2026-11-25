import { STANDARD_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type * as T from './types'

/** The server API spec that this module follows. */
export const SPEC = 'payment.openapi.yaml'

/*
 * Follows `payment.openapi.yaml`.
 * It includes 12 of the 21 APIs: the 6 that the PG payment flow uses and 6 more that the Unity SDK also provides.
 * Server-only APIs and the APIs of the Apple, Google and Steam stores are not included.
 * The `outcomes` lists match the payment domain codes in the spec's 400 responses and the Unity SDK.
 */

export const listStoreProductIds = op<
  T.ListStoreProductIdsRequest,
  T.ListStoreProductIdsResponse
>()({
  id: 'listStoreProductIds',
  method: 'POST',
  path: '/payment/v1/store',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter'],
  failures: STANDARD_FAILURES,
})

export const fetchPgProducts = op<T.FetchPgProductsRequest, T.FetchPgProductsResponse>()({
  id: 'fetchPgProducts',
  method: 'POST',
  path: '/payment/v1/product/pg',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter'],
  failures: STANDARD_FAILURES,
})

export const createPrePurchase = op<T.CreatePrePurchaseRequest, T.CreatePrePurchaseResponse>()({
  id: 'createPrePurchase',
  method: 'POST',
  path: '/payment/v1/purchase/pre',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter'],
  failures: STANDARD_FAILURES,
})

export const createPaymentUrl = op<T.CreatePaymentUrlRequest, T.CreatePaymentUrlResponse>()({
  id: 'createPaymentUrl',
  method: 'POST',
  path: '/payment/v1/order/pay-page-url',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter'],
  failures: STANDARD_FAILURES,
})

export const recordStorePurchase = op<
  T.RecordStorePurchaseRequest,
  T.RecordStorePurchaseResponse
>()({
  id: 'recordStorePurchase',
  method: 'POST',
  path: '/payment/v1/purchase',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'payment_bad_request',
    'payment_invalid_parameter',
    'payment_resource_not_found',
    'payment_unauthorized',
    'verify_error',
  ],
  failures: STANDARD_FAILURES,
})

export const finalizePurchase = op<T.FinalizePurchaseRequest, T.FinalizePurchaseResponse>()({
  id: 'finalizePurchase',
  method: 'POST',
  path: '/payment/v1/purchase/finalize',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter', 'payment_resource_not_found'],
  failures: STANDARD_FAILURES,
})

export const restorePurchases = op<T.RestorePurchasesRequest, T.RestorePurchasesResponse>()({
  id: 'restorePurchases',
  method: 'POST',
  path: '/payment/v1/purchase/restore',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter', 'payment_resource_not_found'],
  failures: STANDARD_FAILURES,
})

export const requestPurchase = op<T.RequestPurchaseRequest, T.RequestPurchaseResponse>()({
  id: 'requestPurchase',
  method: 'POST',
  path: '/payment/v1/purchase/post',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'payment_bad_request',
    'payment_invalid_parameter',
    'payment_resource_not_found',
    'payment_unauthorized',
    'verify_duplicated',
    'verify_error',
  ],
  failures: STANDARD_FAILURES,
})

export const itemResult = op<T.ItemResultRequest, T.ItemResultResponse>()({
  id: 'itemResult',
  method: 'POST',
  path: '/payment/v1/item/result',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'payment_bad_request',
    'payment_invalid_parameter',
    'payment_resource_not_found',
    'invalid_quantity',
    'invalid_status',
  ],
  failures: STANDARD_FAILURES,
})

export const prepareSubscription = op<
  T.PrepareSubscriptionRequest,
  T.PrepareSubscriptionResponse
>()({
  id: 'prepareSubscription',
  method: 'POST',
  path: '/payment/v1/subscription/pre',
  credential: 'session',
  params: { body: 'body' },
  outcomes: ['payment_bad_request', 'payment_invalid_parameter', 'payment_resource_not_found'],
  failures: STANDARD_FAILURES,
})

export const purchaseSubscription = op<
  T.PurchaseSubscriptionRequest,
  T.PurchaseSubscriptionResponse
>()({
  id: 'purchaseSubscription',
  method: 'POST',
  path: '/payment/v1/subscription/purchase',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'payment_bad_request',
    'payment_invalid_parameter',
    'payment_resource_conflict',
    'payment_resource_not_found',
    'payment_unauthorized',
    'verify_error',
  ],
  failures: STANDARD_FAILURES,
})

export const postSubscription = op<T.PostSubscriptionRequest, T.PostSubscriptionResponse>()({
  id: 'postSubscription',
  method: 'POST',
  path: '/payment/v1/subscription/post',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'payment_bad_request',
    'payment_invalid_parameter',
    'payment_resource_not_found',
    'payment_unauthorized',
    'verify_duplicated',
    'verify_error',
  ],
  failures: STANDARD_FAILURES,
})
