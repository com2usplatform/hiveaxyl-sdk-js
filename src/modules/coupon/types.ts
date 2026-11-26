/** Request for `redeemCoupon`. */
export interface RedeemCouponRequest {
  readonly body: {
    /**
     * Coupon code of 8 to 20 alphanumeric characters.
     * The server strips hyphens typed for readability (e.g. `1234-ABCD`), so you can send them as is.
     * The code is case-insensitive.
     */
    readonly couponCode: string
  }
}

/** Response for `redeemCoupon`. */
export interface RedeemCouponResponse {
  /** ID of the mail that holds the reward. */
  readonly mailId: string
}
