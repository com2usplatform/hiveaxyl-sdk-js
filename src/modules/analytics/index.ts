import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type { CollectClientLogRequest } from './types'

/** Options for the `analytics` module. */
export type AnalyticsOptions = ModuleOptions

/**
 * Registers the analytics module.
 * It sends client log events that the game defines.
 * Logs can be sent before login.
 * After login, the server identifies the player from the access token.
 *
 * @example
 * await axyl.analytics.collectClientLog({
 *   body: { logBody: [{ eventTime: new Date().toISOString(), eventName: 'stage_clear', stage: 3 }] },
 * })
 */
export function analytics(options: AnalyticsOptions = {}) {
  return defineModule('analytics', HOSTS.data, options, ({ call }) => ({
    /**
     * Sends client log events to the server.
     * The server declares no business `outcome` codes for this API.
     * It works with or without a session.
     * Do not put tokens, passwords, or personal data such as email addresses in log fields.
     * The SDK sends the fields as they are, and the server stores them.
     *
     * The SDK sends this request with `keepalive` when it fits the limit below.
     * Closing the tab or leaving the page right after the call then does not cancel it.
     * You do not need to collect logs and send them on `pagehide`.
     * Only a request that has already gone out outlives the page.
     * A call that is waiting for a token refresh or a retry when the tab closes can be lost.
     *
     * Browsers allow at most 64 KiB in total for the bodies of `keepalive` requests in progress on one page.
     * Every SDK client on the page, `navigator.sendBeacon`, and your own `keepalive` requests share this limit.
     * The SDK keeps the requests of each client under it.
     * A request whose body would go over goes out without `keepalive`, and closing the tab can then cancel it.
     * The SDK does not split a large body. Keep each call well under 64 KiB if the log must survive the tab closing.
     * If the browser rejects a request because the page is over the limit, the call ends as a `failure` with `Unavailable`.
     */
    collectClientLog: (req: CollectClientLogRequest, o?: CallOptions) =>
      call(ops.collectClientLog, req, o),
  }))
}

/** The API that the `analytics` module adds to the client. */
export type AnalyticsModule = ReturnType<typeof analytics>
export type * from './types'
