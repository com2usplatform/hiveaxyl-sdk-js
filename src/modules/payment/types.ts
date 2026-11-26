import type { OpenEnum } from '../../core/operation'

/*
 * Types follow `payment.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 */

/** Store identifier. The spec declares all four stores. The web uses `PG`. */
export type ProviderId = 'APPLE' | 'GOOGLE' | 'PG' | 'STEAM'

/** Client operating system. */
export type ClientOs = 'WINDOWS' | 'MACOS' | 'ANDROID' | 'IOS' | 'WEBGL'

/** Request for `fetchPgProducts`. */
export interface FetchPgProductsRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. The list uses the tier prices of this currency. */
    readonly currency: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Product type to filter by. */
    readonly productType?: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
    /** Game server ID. It is not used for the product lookup. */
    readonly serverId?: string
  }
}

/** An offer of a product. */
export interface ProductOffer {
  /** Base plan ID of a subscription. `null` for a one-time offer. */
  readonly basePlanId?: string | null
  /** Currency code, as three-letter ISO 4217. */
  readonly currency?: string
  /** Price for display. */
  readonly displayPrice?: string
  /** Offer token. */
  readonly offerToken?: string
  /** Price, with the decimal places of the currency. */
  readonly price?: number
}

/** A product in the product list. */
export interface Product {
  /** Product ID. */
  readonly productId?: string
  /** Product title. */
  readonly title?: string
  /** Product description. */
  readonly description?: string | null
  /** `consumable` or `subscription`. */
  readonly productType?: string | null
  /** Currency code, as three-letter ISO 4217. */
  readonly currency?: string
  /** Price, with the decimal places of the currency (e.g. KRW 9900, USD 9.99). */
  readonly price?: number
  /** Price for display. */
  readonly displayPrice?: string
  /** Original price, with the decimal places of the currency. */
  readonly originalPrice?: number
  /** Original price for display. */
  readonly displayOriginalPrice?: string
  /** Offers. `null` when there are none. */
  readonly offers?: readonly ProductOffer[] | null
}

/** Response for `fetchPgProducts`. */
export interface FetchPgProductsResponse {
  /** App version. */
  readonly appVersion?: string | null
  /** Country code. */
  readonly country?: string
  /** Currency code. */
  readonly currency?: string
  /** Language code. */
  readonly language: string
  /** Store identifier. */
  readonly providerId: OpenEnum<ProviderId>
  /** Products. */
  readonly products?: readonly Product[]
}

/** Request for `createPaymentUrl`. */
export interface CreatePaymentUrlRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Language code, as two-letter ISO 639-1. Payment method names use this language. */
    readonly language: string
    /** Client operating system. Use `WEBGL` on the web. */
    readonly os: ClientOs
    /** Product ID. */
    readonly productId: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
    /** Quantity, from 1 to 999. */
    readonly quantity: number
    /** Game server ID. */
    readonly serverId?: string
    /** JSON string that is passed to the app server unchanged. */
    readonly iapPayload?: string
    /**
     * Amount set by the app server instead of the product price.
     * Send it together with `fixedCurrency` and `gameServerPriceVerifyKey`.
     */
    readonly customPrice?: string
    /** Currency code, as three-letter ISO 4217. Required with `customPrice`. */
    readonly fixedCurrency?: string
    /** Amount verification key issued by the app server. Required with `customPrice`. */
    readonly gameServerPriceVerifyKey?: string
  }
}

/** Response for `createPaymentUrl`. */
export interface CreatePaymentUrlResponse {
  /**
   * URL of the PG payment page. It works only until the order expires.
   * `PaymentWindow.show` opens only `https:` URLs.
   * It carries the encrypted order. Do not log it.
   */
  readonly payUrl?: string
  /** Creation time. */
  readonly createdAt?: string
}

/** Request for `finalizePurchase`. */
export interface FinalizePurchaseRequest {
  readonly body: {
    /**
     * Receipt. For PG, use the `axylReceipt` from the `restorePurchases` response.
     * Send it unchanged.
     */
    readonly axylReceipt: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
  }
}

/** Response for `finalizePurchase`. */
export interface FinalizePurchaseResponse {
  /** PG order number, starting with `H`. */
  readonly orderId?: string
  /** Transaction ID. For PG, this is the Axyl transaction number. */
  readonly storeTransactionId?: string | null
}

/** Request for `restorePurchases`. */
export interface RestorePurchasesRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
    /** Game server ID. When given, only that server's orders are returned. */
    readonly serverId?: string
  }
}

/** A purchase whose items were not granted. */
export interface RestoredPurchase {
  /** Store identifier. */
  readonly providerId: OpenEnum<ProviderId>
  /** Order ID. */
  readonly orderId?: string
  /** Transaction ID. */
  readonly storeTransactionId?: string
  /** Product ID. */
  readonly productId?: string
  /** Quantity. */
  readonly quantity?: number
  /** Price. */
  readonly price?: number
  /** Currency code. */
  readonly currency?: string | null
  /** Receipt for the app server to verify. PG purchases always have it. */
  readonly axylReceipt?: string | null
  /** JSON string sent with the purchase. */
  readonly iapPayload?: string | null
  /** Amount verification key issued by the app server. */
  readonly gameServerPriceVerifyKey?: string | null
  /** Purchase start time, as `yyyy-MM-dd HH:mm:ss`. */
  readonly startedDateTime?: string | null
  /** Purchase start time in epoch milliseconds. */
  readonly startedDateTimeMs?: number | null
  /** Payment time, as `yyyy-MM-dd HH:mm:ss`. */
  readonly paidDateTime?: string | null
  /** Payment time in epoch milliseconds. */
  readonly paidDateTimeMs?: number | null
  /** Store purchase time. PG does not use it, so it is `null`. */
  readonly purchaseDateTime?: number | null
}

/** Response for `restorePurchases`. */
export interface RestorePurchasesResponse {
  /** Purchases to restore. */
  readonly restores?: readonly RestoredPurchase[]
}

/** A response without content. The spec declares `data` as an empty object or `null`. */
export type EmptyResponse = Readonly<Record<string, never>> | null

/** Request for `createPrePurchase`. */
export interface CreatePrePurchaseRequest {
  readonly body: {
    /**
     * UUIDv5 built from the `playerId` as a decimal string.
     * The app creates it. The SDK does not.
     * The game chooses the namespace and never changes it within one game.
     */
    readonly accountUuid?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. */
    readonly currency: string
    /** JSON string that is passed to the app server unchanged. */
    readonly iapPayload?: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Amount to be paid. It may have decimal places, depending on the currency. */
    readonly price: number
    /** Product ID. */
    readonly productId: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
    /** Request time, as ISO 8601 UTC. */
    readonly requestDate?: string
    /** Game server ID. */
    readonly serverId?: string
  }
}

/** Response for `createPrePurchase`. */
export type CreatePrePurchaseResponse = EmptyResponse

/** Request for `recordStorePurchase`. */
export interface RecordStorePurchaseRequest {
  readonly body: {
    /** Must equal the value sent to `createPrePurchase`. */
    readonly accountUuid?: string
    /**
     * Receipt. For PG, use the `axylReceipt` from the `restorePurchases` response.
     * Send it unchanged.
     */
    readonly axylReceipt: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. It is only compared together with `price`. */
    readonly currency?: string
    /** JSON string that is passed to the app server unchanged. */
    readonly iapPayload?: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** PG order number, starting with `H`. The server finds the order by this or by `storeTransactionId`. */
    readonly orderId?: string
    /** Only compared with the server value. A mismatch may be rejected. */
    readonly price?: number
    /** Product ID. For PG, the server uses its order data and ignores this value. */
    readonly productId: string
    /** JSON string that the server stores but does not pass to the app server. */
    readonly projectInfo?: string
    /** Store identifier. Use `PG`. */
    readonly providerId: ProviderId
    /** Quantity. */
    readonly quantity?: number
    /** Request time, as ISO 8601. The server time is used when omitted. */
    readonly requestDate?: string
    /** `1` for a new purchase, `2` for a restored purchase. */
    readonly requestType?: number
    /** Game server ID. */
    readonly serverId?: string
    /** Transaction ID. */
    readonly storeTransactionId?: string
  }
}

/** Response for `recordStorePurchase`. */
export type RecordStorePurchaseResponse = EmptyResponse

/** Request for `listStoreProductIds`. */
export interface ListStoreProductIdsRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Store identifier. Use `PG` on the web. */
    readonly providerId: ProviderId
  }
}

/** The product IDs registered for one store. */
export interface StoreProductIds {
  /** App ID. */
  readonly appId?: string
  /** Product IDs of subscriptions. */
  readonly productSubscriptions?: readonly string[]
  /** Product IDs of consumables. */
  readonly products?: readonly string[]
  /** Store identifier. */
  readonly providerId: OpenEnum<ProviderId>
}

/** Response for `listStoreProductIds`. */
export interface ListStoreProductIdsResponse {
  /** One entry per store. */
  readonly stores: readonly StoreProductIds[]
}

/** Request for `requestPurchase`. */
export interface RequestPurchaseRequest {
  readonly body: {
    /**
     * Receipt. For PG, use the `axylReceipt` from the `restorePurchases` response.
     * Send it unchanged.
     */
    readonly axylReceipt: string
    /** Finalization message. The server stores it only for `APPLE` and `GOOGLE`. */
    readonly finalizationMsg?: string
    /** Product ID registered in the store. Only `GOOGLE` uses it. It is required when `axylReceipt` is a purchase token. */
    readonly productId?: string
    /** Store identifier. Use `PG` on the web. */
    readonly providerId: ProviderId
    /** Order number of the store. Only `APPLE` uses it, and `APPLE` requires it. */
    readonly storeTransactionId?: string
  }
}

/** Response for `requestPurchase`. */
export type RequestPurchaseResponse = EmptyResponse

/** An item that the game granted. */
export interface ItemResultAsset {
  /** Item ID in the game. */
  readonly assetId?: string
  /** Item name in the game. */
  readonly assetName?: string
  /** Granted quantity, 1 or more. */
  readonly quantity?: number
}

/** Request for `itemResult`. */
export interface ItemResultRequest {
  readonly body: {
    /** Items that were granted. Omit the field when there is nothing to send. The server skips an empty entry. */
    readonly assets?: readonly ItemResultAsset[]
    /** Axyl payment transaction ID. */
    readonly axylTransactionId: string
    /** JSON data in a shape that the game chooses. */
    readonly projectPayloadInfo?: Readonly<Record<string, unknown>>
    /** `1` for granted, `2` for cancelled without taking the items back, `3` for cancelled with the items taken back. */
    readonly status: number
  }
}

/** Response for `itemResult`. */
export type ItemResultResponse = EmptyResponse

/** Request for `prepareSubscription`. */
export interface PrepareSubscriptionRequest {
  readonly body: {
    /**
     * UUIDv5 built from the `playerId` as a decimal string.
     * The app creates it. The SDK does not.
     * The game chooses the namespace and never changes it within one game.
     */
    readonly accountUuid?: string
    /** App version. */
    readonly appVersion?: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. */
    readonly currency: string
    /** JSON string that is passed to the app server unchanged. */
    readonly iapPayload?: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Price. */
    readonly price: number
    /** Product ID. */
    readonly productId: string
    /** Store identifier. */
    readonly providerId: ProviderId
    /** Request time in epoch milliseconds. */
    readonly requestTimeMs?: number
    /** Game server ID. */
    readonly serverId?: string
  }
}

/** Response for `prepareSubscription`. */
export interface PrepareSubscriptionResponse {
  /** ID of the stored record. */
  readonly hiveAxylPrePurchaseId: string
  /** Product ID of the subscription. */
  readonly hiveAxylProductId: string
}

/** Request for `purchaseSubscription`. */
export interface PurchaseSubscriptionRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Receipt of the subscription purchase. Send it unchanged. */
    readonly axylReceipt: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. */
    readonly currency: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Price before the discount. */
    readonly originalPrice?: number
    /** Price. */
    readonly price: number
    /** Store identifier. */
    readonly providerId: ProviderId
    /** Request time in epoch milliseconds. */
    readonly requestTimeMs?: number
    /** Game server ID. */
    readonly serverId?: string
    /** Transaction ID of the store. */
    readonly storeTransactionId?: string
  }
}

/** Response for `purchaseSubscription`. */
export interface PurchaseSubscriptionResponse {
  /** Product ID of the stored subscription. The store's verification decides it, so it can differ from the request. */
  readonly hiveAxylProductId?: string
  /** Lookup key of the subscription record. */
  readonly hiveAxylStoreTransactionId?: string
  /** Transaction ID of the stored subscription record. */
  readonly hiveAxylTransactionId: string
}

/** Request for `postSubscription`. */
export interface PostSubscriptionRequest {
  readonly body: {
    /** App version. */
    readonly appVersion?: string
    /** Receipt of the subscription purchase. Send it unchanged. */
    readonly axylReceipt: string
    /** Country code, as two-letter ISO 3166-1. */
    readonly country: string
    /** Currency code, as three-letter ISO 4217. */
    readonly currency: string
    /** Language code, as two-letter ISO 639-1. */
    readonly language: string
    /** Product ID of the subscription. */
    readonly productId: string
    /** Store identifier. */
    readonly providerId: ProviderId
    /** Request time in epoch milliseconds. */
    readonly requestTimeMs?: number
    /** `1` for a new purchase, `2` for a restored purchase. */
    readonly requestType?: number
    /** Game server ID. */
    readonly serverId?: string
  }
}

/** Response for `postSubscription`. */
export interface PostSubscriptionResponse {
  /** Product ID of the subscription. When nothing was closed, it is the value from the request. */
  readonly hiveAxylProductId: string
  /** Lookup key of the subscription record. */
  readonly hiveAxylStoreTransactionId?: string
  /**
   * Transaction ID of the closed subscription record.
   * `null` when there was nothing to close. A `success` result does not mean a record was closed, so check this value.
   */
  readonly hiveAxylTransactionId?: string | null
}
