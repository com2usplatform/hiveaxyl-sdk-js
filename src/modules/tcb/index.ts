import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type * as T from './types'

/** Options for the `tcb` module. */
export type TcbOptions = ModuleOptions

/**
 * Registers the TCB module.
 * It runs Cloud Functions registered on TCB (Tencent CloudBase).
 *
 * @example
 * const r = await axyl.tcb.processGatewayRequest({
 *   body: { region, namespace, functionName: 'hello', functionParam: JSON.stringify({ a: 1 }) },
 * })
 */
export function tcb(options: TcbOptions = {}) {
  return defineModule('tcb', HOSTS.app, options, ({ call }) => ({
    /**
     * Runs a Cloud Function stored on TCB.
     *
     * The server can answer with these `outcome` codes:
     * - `scf_invocation_failed`: The call to TCB itself failed.
     * - `function_execution_failed`: The function ended with a runtime error.
     *   `data` has `invokeResult`, `errMsg`, and `functionRequestId`.
     * - `invalid_parameter`: The request parameters failed validation.
     * - `credential_not_found`: No active API credential is registered for this project. It is not a player sign-in problem.
     * - `invalid_function_param`: `functionParam` is not a JSON object.
     * - `function_not_found`: TCB has no such function or namespace.
     *   `data` has `scfErrorCode`, `scfMessage`, and `scfRequestId`.
     * - `scf_invalid_parameter`: TCB rejected the request parameters.
     *   `data` has `scfErrorCode`, `scfMessage`, and `scfRequestId`.
     */
    processGatewayRequest: (req: T.ProcessGatewayRequestRequest, o?: CallOptions) =>
      call(ops.processGatewayRequest, req, o),
  }))
}

/** The API that the `tcb` module adds to the client. */
export type TcbModule = ReturnType<typeof tcb>
export type * from './types'
