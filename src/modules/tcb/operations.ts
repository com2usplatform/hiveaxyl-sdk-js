import { op } from '../../core/operation'
import type * as T from './types'

/** The server API spec that this module follows. */
export const SPEC = 'tcb.openapi.yaml'

/**
 * Runs a Cloud Function. Follows `tcb.openapi.yaml`.
 * The `outcomes` list matches the `code` values in the spec's 400 and 422 response examples.
 * It has the same 7 codes as the Unity SDK.
 * The tcb spec declares no common errors.
 * So `invalid_parameter` is a business outcome for this API.
 */
export const processGatewayRequest = op<
  T.ProcessGatewayRequestRequest,
  T.ProcessGatewayRequestResponse
>()({
  id: 'processGatewayRequest',
  method: 'POST',
  path: '/tcb/v1/scf/executions',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'scf_invocation_failed',
    'function_execution_failed',
    'invalid_parameter',
    'credential_not_found',
    'invalid_function_param',
    'function_not_found',
    'scf_invalid_parameter',
  ],
  failures: [],
})
