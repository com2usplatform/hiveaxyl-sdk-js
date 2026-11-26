import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type * as T from './types'

/** Options for the `service` module. */
export type ServiceOptions = ModuleOptions

/**
 * Registers the service access module.
 * It checks server maintenance, client updates, and country blocks.
 * Its APIs need no login.
 *
 * @example
 * const r = await axyl.service.checkClientUpdate({ clientVersion: '1.0.0' })
 */
export function service(options: ServiceOptions = {}) {
  return defineModule('service', HOSTS.core, options, ({ call }) => ({
    /**
     * Gets the server maintenance entries that are active now.
     * The list is empty when no maintenance applies.
     * The list is also empty when the client IP or `playerId` is on the app's allowlist.
     * The server declares no business `outcome` codes for this API.
     */
    getActiveMaintenances: (req?: T.GetActiveMaintenancesRequest, o?: CallOptions) =>
      call(ops.getActiveMaintenances, req, o),
    /**
     * Checks whether the client version needs an update.
     * `updateRequired` tells whether an update applies.
     * `forceUpdate` tells whether that update is mandatory.
     * The server declares no business `outcome` codes for this API.
     */
    checkClientUpdate: (req: T.CheckClientUpdateRequest, o?: CallOptions) =>
      call(ops.checkClientUpdate, req, o),
    /**
     * Checks whether the app is blocked in a country.
     * `blocked` holds the answer.
     * The server declares no business `outcome` codes for this API.
     */
    checkCountryBlock: (req: T.CheckCountryBlockRequest, o?: CallOptions) =>
      call(ops.checkCountryBlock, req, o),
  }))
}

/** The API that the `service` module adds to the client. */
export type ServiceModule = ReturnType<typeof service>
export type * from './types'
