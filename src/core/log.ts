/** The severity of a log entry. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * A logger that the app passes to `createAxyl`.
 * Without a logger, the SDK writes no logs.
 * The SDK masks every field that is not on its allowed list before it calls the logger.
 *
 * The SDK logs at the same points as the Unity SDK. A call logs its request once, and how it ended once, after any retries:
 * - `info` `request`: the call went out, with `operation`, `method` and `traceId`.
 * - `info` `retry`: the call waits to send again, with `attempt` and `delayMs`.
 * - `info` `response`: the call ended with a response, with `statusCode`, `attempt`, `durationMs` and `traceId`.
 *   An error response such as a 404 is logged here too.
 * - `warn` `transport error`: the call went out but ended without a usable response, with `errorCode` and `errorMessage`.
 *   This covers no response, a cancel, a `Retry-After` wait over the limit, and a retry that could not go out.
 *   For a `Retry-After` wait over the limit, `warn` `retry-after exceeds the limit` comes first, with the asked wait in `delayMs`.
 * - `warn` `request not sent`: the call stopped before it went out, with `errorCode` and `errorMessage`.
 *   This covers an API that needs `options.accessToken` and got none, a full token refresh queue,
 *   a path parameter or request origin that the SDK refuses, and a header value that cannot be sent.
 *
 * A call that the app cancels before it goes out is not logged. Calls that `dispose()` stops are not logged either.
 * A 401 that makes the SDK refresh the token is not logged as a response. The refresh logs its own result.
 * If the refresh succeeds, the call sends again and logs a new request and response. Otherwise the call ends with no more logs.
 * So a `request` with no end of its own ended with the refresh, or was cancelled while waiting for it.
 * See the token refresh log that follows it.
 * The token refresh logs `info` when it succeeds, `warn` when it fails or is rejected, and `error` when the refresh function throws.
 * A failed refresh that started because the token expired carries `kind`: `offline`, `network` or `timeout`.
 * A refresh result dropped because the session changed meanwhile adds an `info`.
 * A request that waits for a refresh logs `info`. `getAccessToken()` does not log its wait.
 * A session event listener that throws logs `warn`.
 * The SDK also logs `info` when the client is created or disposed, and `warn` once when browser storage is not available.
 * When the environment's OS version has characters a header cannot carry, it logs `warn` once and leaves `X-OS-Version` out.
 *
 * Every entry has a `category` field that names the part of the SDK that logged it, as in the Unity SDK:
 * - `Transport`: requests, retries, responses, calls that were not sent, requests that wait for a token refresh,
 *   and the `X-OS-Version` warning.
 * - `TokenRefresh`: the token refresh.
 * - `Session`: session event listeners and the browser storage warning.
 * - `Core`: the client being created or disposed.
 *
 * Messages are short fixed text, such as `'response'`. They never hold tokens or server text.
 * Match on fields, not on messages. The SDK may add log entries in later versions.
 * Send `traceId` with a problem report so the server team can find the request.
 */
export interface Logger {
  /** Receives one log entry. If it throws, the SDK ignores the error. */
  log(level: LogLevel, message: string, fields: Readonly<Record<string, unknown>>): void
}

/** The common allowed fields. Every Hive Axyl SDK uses this list, with the same names. */
const COMMON_LOG_FIELDS = [
  'errorCode',
  'errorMessage',
  'category',
  'timestamp',
  'traceId',
  'requestId',
  'durationMs',
  'method',
  'url',
  'statusCode',
]

/** The allowed fields that this SDK adds to the common list. */
const SDK_LOG_FIELDS = ['path', 'operation', 'attempt', 'delayMs', 'kind']

/**
 * The fields that are logged as is. Every other value becomes `'***'`.
 * It is an allow list, not a block list, so a new field is masked by default.
 * Names are matched without regard to case, as in the Unity SDK.
 * The app cannot extend this list or turn masking off.
 */
export const LOG_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_LOG_FIELDS,
  ...SDK_LOG_FIELDS,
])

const ALLOWED_LOWER: ReadonlySet<string> = new Set(
  [...LOG_ALLOWED_FIELDS].map((k) => k.toLowerCase()),
)

function maskFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = ALLOWED_LOWER.has(k.toLowerCase()) ? v : '***'
  }
  return out
}

/**
 * Calls app code, such as a logger or a session listener, so that its errors cannot stop the SDK.
 * Returns `false` when it threw.
 * An `async` function returns a promise. Its rejection is the app's error, so it is ignored like a thrown one.
 * Any other return value settles as fulfilled and does nothing.
 */
export function callApp(fn: () => unknown): boolean {
  try {
    const returned = fn()
    void Promise.resolve(returned).then(undefined, () => {})
    return true
  } catch {
    return false
  }
}

export function createLog(logger: Logger | undefined) {
  return (level: LogLevel, message: string, fields: Readonly<Record<string, unknown>> = {}) => {
    if (!logger) return
    // An error in the app logger must not stop the SDK.
    callApp(() => logger.log(level, message, maskFields(fields)))
  }
}
export type Log = ReturnType<typeof createLog>

/** The part of the SDK that logged an entry. The names follow the categories of the Unity SDK. */
type LogCategory = 'Transport' | 'TokenRefresh' | 'Session' | 'Core'

/** Returns a `Log` that sets `category` in the fields of every entry. */
export function withCategory(log: Log, category: LogCategory): Log {
  return (level, message, fields) => log(level, message, { ...fields, category })
}
