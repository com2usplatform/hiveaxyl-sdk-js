import { STANDARD_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type { RedeemCouponRequest, RedeemCouponResponse } from './types'

/** The server API spec that this module follows. */
export const SPEC = 'coupon.openapi.yaml'

/**
 * Redeems a coupon. Follows `coupon.openapi.yaml`.
 * The `outcomes` list matches the business codes in the spec's error mapping.
 */
export const redeemCoupon = op<RedeemCouponRequest, RedeemCouponResponse>()({
  id: 'redeemCoupon',
  method: 'POST',
  path: '/coupon/v1/redeem',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'coupon_account_limit_exceeded',
    'coupon_already_used',
    'coupon_before_start',
    'coupon_code_invalid_format',
    'coupon_code_not_found',
    'coupon_disabled',
    'coupon_expired',
    'coupon_group_limit_exceeded',
    'coupon_resource_not_found',
    'coupon_total_limit_exceeded',
  ],
  failures: STANDARD_FAILURES,
})
