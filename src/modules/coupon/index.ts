import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type { RedeemCouponRequest } from './types'

/** Options for the `coupon` module. */
export type CouponOptions = ModuleOptions

/**
 * Registers the coupon module.
 * The player must be logged in to redeem a coupon.
 *
 * @example
 * createAxyl({ appId, clientId, modules: { auth: auth(), token: token(), coupon: coupon() } })
 */
export function coupon(options: CouponOptions = {}) {
  return defineModule('coupon', HOSTS.commerce, options, ({ call }) => ({
    /**
     * Redeems a coupon.
     * The reward is delivered to the mailbox. The result has the `mailId` of that mail.
     *
     * The server can answer with these `outcome` codes:
     * - `coupon_code_not_found`: The code does not exist.
     * - `coupon_code_invalid_format`: The code format is invalid.
     * - `coupon_disabled`: The coupon or code is disabled.
     * - `coupon_before_start`: The redemption period has not started.
     * - `coupon_expired`: The redemption period has ended.
     * - `coupon_already_used`: The coupon was already used.
     * - `coupon_account_limit_exceeded`: The per-account limit is reached.
     * - `coupon_group_limit_exceeded`: The group limit is reached.
     * - `coupon_total_limit_exceeded`: The total limit is reached.
     * - `coupon_resource_not_found`: A fallback code from the server. The result carries no details.
     *
     * A network failure or a server error (5xx) does not tell whether the coupon was used.
     * Check the mailbox for the reward before you send the request again.
     * A repeated request can end as `coupon_already_used` or a limit code even when the reward is already in the mailbox.
     */
    redeemCoupon: (req: RedeemCouponRequest, o?: CallOptions) => call(ops.redeemCoupon, req, o),
  }))
}

/** The API that the `coupon` module adds to the client. */
export type CouponModule = ReturnType<typeof coupon>
export type * from './types'
