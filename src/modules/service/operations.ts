import { op } from '../../core/operation'
import type * as T from './types'

/** The server API spec that this module follows. */
export const SPEC = 'service.openapi.yaml'

/**
 * The common error codes of the service spec's 4xx answers. The Unity SDK uses the same list.
 * The spec also declares `internal_error` for a 500. Its body has no `outcome` key, so it is a `failure` without being listed.
 */
const SERVICE_FAILURES = ['invalid_parameter', 'missing_field']

/*
 * Follows `service.openapi.yaml`.
 * These APIs are called before login, so they carry no token.
 * The optional `X-Hive-Country-Code` header is not sent.
 * The gateway sets it from the client IP.
 * The Unity SDK does not send it either.
 */

export const getActiveMaintenances = op<
  T.GetActiveMaintenancesRequest | void,
  T.GetActiveMaintenancesResponse
>()({
  id: 'getActiveMaintenances',
  method: 'GET',
  path: '/service/v1/maintenance',
  credential: 'anonymous',
  ids: { response: ['[].id'] },
  params: { query: ['serverCode', 'clientVersion', 'playerId'] },
  outcomes: [],
  failures: SERVICE_FAILURES,
})

export const checkClientUpdate = op<T.CheckClientUpdateRequest, T.CheckClientUpdateResponse>()({
  id: 'checkClientUpdate',
  method: 'GET',
  path: '/service/v1/client-update',
  credential: 'anonymous',
  ids: { response: ['id'] },
  params: { query: ['clientVersion', 'playerId'], requiredQuery: ['clientVersion'] },
  outcomes: [],
  failures: SERVICE_FAILURES,
})

export const checkCountryBlock = op<T.CheckCountryBlockRequest, T.CheckCountryBlockResponse>()({
  id: 'checkCountryBlock',
  method: 'GET',
  path: '/service/v1/country-block',
  credential: 'anonymous',
  ids: { response: ['id'] },
  params: { query: ['countryCode', 'playerId'], requiredQuery: ['countryCode'] },
  outcomes: [],
  failures: SERVICE_FAILURES,
})
