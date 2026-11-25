import { STANDARD_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type { CollectClientLogRequest, CollectClientLogResponse } from './types'

/** The server API spec that this module follows. */
export const SPEC = 'analytics.openapi.yaml'

/**
 * Receives client logs. Follows `analytics.openapi.yaml`.
 * The spec declares no business outcome codes.
 * Without a session, the request goes out without an `Authorization` header.
 * This matches `CollectClientLogAsync` in the Unity SDK.
 * It is marked for `keepalive`, so a log sent just before the tab closes can still reach the server.
 */
export const collectClientLog = op<CollectClientLogRequest, CollectClientLogResponse>()({
  id: 'collectClientLog',
  method: 'POST',
  path: '/analytics/v1/recv',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [],
  failures: STANDARD_FAILURES,
  keepalive: true,
})
