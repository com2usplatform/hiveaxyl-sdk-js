import { SDK_VERSION } from '../version'
import { abortable, isStopped, linkSignals } from './abort'
import type { Adapters, EnvironmentAdapter, HttpRequest } from './adapters'
import { hex } from './encoding'
import { AxylUsageError } from './errors'
import { stringifyWithIds } from './int64'
import type { Log } from './log'
import { isIdempotent, type AnyOperation, type Operation } from './operation'
import { refused, type NoResponse, type TokenRefusal } from './refusal'
import {
  classify,
  failure,
  type AxylResult,
  type ClassifyOperation,
  type Failure,
  type RawResponse,
} from './result'
import { parseRetryAfter, RETRY_AFTER_TOO_LONG, retryDelay, type RetryPolicy } from './retry'
import type { RequestToken, Session } from './session'
import { isNonBlank } from './tokens'
import { buildUrl } from './url'

/**
 * Value of the `X-Platform` header. It matches what a Unity SDK 1.0 WebGL build sends (`UnityAppEnvironment.GetOS`).
 * The API spec allows any string for this header.
 * The `os` field in a payment body is a different field. Its value is `WEBGL`.
 */
const PLATFORM = 'WebGL'

/** A W3C trace ID: 32 lowercase hex characters. Like the Unity SDK, it does not reject an all-zero value. */
const TRACE_ID = /^[0-9a-f]{32}$/

/**
 * Checks whether `fetch` would refuse this header value. NUL, CR, LF or a character above 0xFF makes `fetch` throw.
 * That exception looks the same as a connection failure. So the value is checked before sending.
 */
function isUnsendableHeader(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 0x00 || c === 0x0a || c === 0x0d || c > 0xff) return true
  }
  return false
}

/**
 * The total body size of `keepalive` requests in progress that browsers allow, in bytes (64 KiB).
 * Above it, `fetch` rejects the request at once.
 */
const KEEPALIVE_BUDGET_BYTES = 65_536

/** Counts the body bytes of `keepalive` requests in progress for one client. */
interface KeepaliveBudget {
  /**
   * Reserves `bytes` if they fit in the budget. Returns a function that gives them back, or `undefined` when they do not fit.
   * Calling the returned function again does nothing.
   */
  reserve(bytes: number): (() => void) | undefined
}

export function createKeepaliveBudget(): KeepaliveBudget {
  let inFlight = 0
  return {
    reserve(bytes) {
      if (inFlight + bytes > KEEPALIVE_BUDGET_BYTES) return undefined
      inFlight += bytes
      let released = false
      return () => {
        if (released) return
        released = true
        inFlight -= bytes
      }
    },
  }
}

/**
 * Options that the app can pass to a single API call.
 * A call throws `AxylUsageError` when a value has the wrong type, such as a `signal` that is not an `AbortSignal`.
 */
export interface CallOptions {
  /**
   * Cancels the call. A cancelled call returns a `failure` with code `Cancelled`.
   * A cancel counts until the call returns, even after the response arrived.
   */
  readonly signal?: AbortSignal
  /**
   * Idempotency key for the call. It applies only to APIs that declare an `Idempotency-Key` header.
   * If you omit it, the SDK creates a new key for each call. A call that you send again yourself is then a new action to the server.
   * To send an action again safely, create a key in the app and pass it from the first call.
   * Pass that same key when you send the action again, so the server runs it only once.
   * An empty or whitespace-only key throws `AxylUsageError` on any call, even one whose API declares no key.
   */
  readonly idempotencyKey?: string
  /**
   * Access token for APIs that act on a token the caller supplies, such as `loginWithAccessToken`.
   * Other APIs ignore its value.
   * If such an API gets no token or an empty one, it returns a `failure` with code `InvalidArgument`.
   * Sensitive. Do not log or persist.
   */
  readonly accessToken?: string
}

/**
 * Reads `options` once and returns a copy of the checked values.
 * Throws `AxylUsageError` when `options` does not have the shape of `CallOptions`.
 * The types already catch this. This check is for JavaScript and `<script>` users, who would otherwise get a `TypeError`.
 * A signal is checked by its shape, not with `instanceof`, so a signal from another window or realm still works.
 * The call uses only the copy. A getter on `options` could return another value on a later read and skip the check.
 */
export function readCallOptions(id: string, options: unknown): CallOptions | undefined {
  if (options === undefined || options === null) return undefined
  if (typeof options !== 'object') {
    throw new AxylUsageError(`${id} options must be an object.`)
  }
  const { signal, idempotencyKey, accessToken } = options as Record<string, unknown>
  // `null` means no signal, as in `fetch`. Before this check it was accepted the same way.
  if (signal !== undefined && signal !== null) {
    const s = signal as {
      aborted?: unknown
      addEventListener?: unknown
      removeEventListener?: unknown
    } | null
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof s.aborted !== 'boolean' ||
      typeof s.addEventListener !== 'function' ||
      typeof s.removeEventListener !== 'function'
    ) {
      throw new AxylUsageError(`${id} options.signal must be an AbortSignal.`)
    }
  }
  // `null` means no key, so the SDK creates one, as before this check.
  if (
    idempotencyKey !== undefined &&
    idempotencyKey !== null &&
    typeof idempotencyKey !== 'string'
  ) {
    throw new AxylUsageError(`${id} options.idempotencyKey must be a string.`)
  }
  // A blank key would be the same key for every call, so the server could drop a later action as a duplicate.
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() === '') {
    throw new AxylUsageError(
      `${id} options.idempotencyKey must not be empty. Leave it out to let the SDK create one.`,
    )
  }
  // `null` is what `getAccessToken()` returns without a session. It ends as an `InvalidArgument` result, as in the Unity SDK.
  if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
    throw new AxylUsageError(`${id} options.accessToken must be a string.`)
  }
  return {
    ...(signal != null && { signal: signal as AbortSignal }),
    ...(idempotencyKey != null && { idempotencyKey: idempotencyKey as string }),
    ...(accessToken != null && { accessToken: accessToken as string }),
  }
}

export type CallFn = <Req, Res, O extends string, M = unknown>(
  operation: Operation<Req, Res, O, M>,
  req: Req,
  options?: CallOptions,
) => Promise<AxylResult<Res, O, M>>

export interface TransportContext {
  readonly appId: string
  readonly adapters: Adapters
  readonly session: Session
  readonly log: Log
  /** Signal that `dispose()` aborts. It stops every request and wait in progress. */
  readonly lifetime: AbortSignal
  readonly clientSessionId: string
  /** Value of the `X-OS-Version` header, read once with `osVersionHeader`. Without it, the header is not sent. */
  readonly osVersion: string | undefined
  /** Values the app set with `createAxyl({ network })`. Omitted items use the defaults. */
  readonly retryPolicy: RetryPolicy
  /** Body bytes of `keepalive` requests in progress. Every module of the client shares it. */
  readonly keepalive: KeepaliveBudget
  /** Accept-Language. `setLanguage()` can change it, so read it on every request. */
  language(): string | undefined
  assertAlive(): void
}

/**
 * Reads the `X-OS-Version` value once, when the client is created.
 * The Unity SDK also reads the OS once and leaves the header out when the value is empty.
 * A value with characters other than visible ASCII is left out too, or every call would fail on that header.
 */
export function osVersionHeader(environment: EnvironmentAdapter, log: Log): string | undefined {
  const osVersion = environment.osVersion?.() || undefined
  if (osVersion !== undefined && !/^[\x20-\x7e]+$/.test(osVersion)) {
    log('warn', 'os version not sent: it has characters a header cannot carry')
    return undefined
  }
  return osVersion
}

type Sent =
  | (RawResponse & {
      readonly kind: 'response'
      readonly retryAfter: string | null
      readonly traceId: string
    })
  | { readonly kind: NoResponse }

/**
 * Creates the request function that a module receives. A module holds only this function and never touches the session or the core.
 * Order: prepare the URL and the body, take a token (waiting for a refresh if one runs), add the headers, send,
 * refresh on 401 and send again, classify, retry.
 */
export function createCaller(ctx: TransportContext, baseUrl: string): CallFn {
  const { adapters, session } = ctx
  const random = () => adapters.crypto.randomBytes(1)[0]! / 256
  const now = () => adapters.clock.now()

  return async <Req, Res, O extends string, M = unknown>(
    operation: Operation<Req, Res, O, M>,
    req: Req,
    options?: CallOptions,
  ): Promise<AxylResult<Res, O, M>> => {
    ctx.assertAlive()
    const opts = readCallOptions(operation.id, options)
    const log = createCallLog(ctx, operation, () => isStopped(ctx.lifetime, opts?.signal))
    // `getAccessToken()` can return `null` at run time. So this is a result, not an exception, as in the Unity SDK.
    if (operation.credential === 'caller' && !isNonBlank(opts?.accessToken)) {
      return log.notSent(
        failure('InvalidArgument', `${operation.id} needs a non-empty options.accessToken.`),
      )
    }
    const prepared = prepareRequest(ctx, baseUrl, operation, req, opts)
    if (prepared.kind === 'failure') return log.notSent(prepared)
    const { url, body, keepaliveBytes, idempotencyKey } = prepared
    const idempotent = isIdempotent(operation)
    // One W3C trace context per send through the pipeline, as in the Unity SDK.
    // A retry sends the same `traceparent` again. The send after a 401 and a refresh starts a new one.
    const newTrace = () => {
      const id = hex(adapters.crypto.randomBytes(16))
      return { id, header: `00-${id}-${hex(adapters.crypto.randomBytes(8))}-01` }
    }
    let trace = newTrace()

    let refreshed = false
    /** Token of the current send through the pipeline. Its retries send it again. */
    let passToken: RequestToken | undefined
    /** Session generation of the first attempt. Retries use only tokens of the same session. */
    let firstGeneration: number | undefined

    /**
     * The session token of an attempt that does not wait for a refresh. Returns `undefined` when the attempt must wait.
     * As in the Unity SDK, a send through the pipeline waits for a refresh once, before its first attempt.
     * Retries send the same token again. The send after a 401 and a refresh takes the renewed token without waiting again.
     * A token that expires between attempts gets a 401, and that 401 refreshes it.
     */
    const tokenWithoutWait = (attempt: number): RequestToken | TokenRefusal | undefined => {
      if (passToken !== undefined && attempt > 0) {
        if (session.writer.generation() !== passToken.generation) return 'sessionChanged'
        return session.restamp(passToken)
      }
      if (refreshed && attempt === 0) return session.currentToken()
      return undefined
    }

    // One signal for both the app's cancel and dispose(). The refresh wait, the send and the retry wait all watch it.
    const callCtrl = new AbortController()
    const signal = callCtrl.signal
    const unlink = linkSignals(callCtrl, [ctx.lifetime, opts?.signal])

    /**
     * Ends a call that got no token.
     * Before the first send, only a full queue is logged here. A refresh logs its own result.
     * On a retry, the send already went out, so its end is logged.
     * A call cancelled before it got a token ends as cancelled, not sent and not logged, whatever the refusal was.
     * The refresh it waited for may have settled just before the cancel.
     */
    const stop = (reason: TokenRefusal): Failure => {
      if (log.sent) return log.ended(refused(reason))
      if (signal.aborted) return refused('cancelled')
      if (reason === 'exhausted') return log.notSent(refused(reason))
      return refused(reason)
    }

    try {
      for (let attempt = 0; ; attempt++) {
        let token: string | undefined
        let used: RequestToken | undefined
        if (operation.credential === 'session') {
          const t = tokenWithoutWait(attempt) ?? (await session.tokenForRequest(signal))
          if (typeof t === 'string') return stop(t)
          if (signal.aborted) return stop('cancelled')
          firstGeneration ??= t.generation
          if (t.generation !== firstGeneration) return stop('sessionChanged')
          used = t
          passToken = t
          // Signed out: send without `Authorization`. The server's 401 becomes the result, because there is nothing to refresh.
          token = t.token ?? undefined
        } else if (operation.credential === 'caller') {
          token = opts?.accessToken
        }
        // A call without the session token skips the check above. A call cancelled before it goes out is not sent or logged.
        if (signal.aborted) return stop('cancelled')

        const headers = buildHeaders(ctx, { trace: trace.header, body, idempotencyKey, token })
        // If a setting, an option or a server token has characters that cannot be sent, end now instead of retrying as a network error.
        // A value may hold a token, so the message names only the header.
        const unsendable = Object.keys(headers).find((k) => isUnsendableHeader(headers[k]!))
        if (unsendable !== undefined) {
          const f = failure(
            'InvalidArgument',
            `Header "${unsendable}" has characters that cannot be sent.`,
          )
          return log.sent ? log.ended(f) : log.notSent(f)
        }

        log.sending(attempt, trace.id)
        const sent = await sendOnce(
          ctx,
          { url, method: operation.method, headers, ...(body !== undefined && { body }) },
          signal,
          trace.id,
          keepaliveBytes,
        )
        // The response can arrive before a cancel or dispose() that comes while the body is read. The call still ends as cancelled.
        if (signal.aborted) return log.ended(refused('cancelled'))

        /** The session token that got a 401, if any. */
        const rejected =
          sent.kind === 'response' && sent.status === 401 && used?.token != null ? used : undefined
        if (rejected !== undefined && session.writer.generation() !== rejected.generation) {
          // A 401 for a request from a sign-in that was replaced or ended, even a resend after a refresh.
          // As in the Unity SDK, it does not refresh and ends as a session change. The Unity SDK logs no end for it either.
          return refused('sessionChanged')
        }
        if (rejected !== undefined && refreshed) {
          // The refreshed token was rejected too. Do not refresh again. Only record it so the app does not get that token.
          session.markRejected(rejected)
        } else if (rejected !== undefined) {
          // A call refreshes after a 401 at most once.
          // The refresh logs its own result, and the Unity SDK logs nothing more for a send that ends here.
          const generation = session.writer.generation()
          const outcome = await session.refreshAfter401(rejected, signal)
          if (signal.aborted) return refused('cancelled')
          if (outcome === 'renewed') {
            refreshed = true
            trace = newTrace()
            log.newPass()
            // The send after a refresh starts over, as in the Unity SDK: the retry count and the backoff begin again from the first attempt.
            // It cannot loop, because `refreshed` stops a second refresh in the same call.
            attempt = -1
            continue
          }
          if (outcome !== 'unauthenticated') return refused(outcome)
          // A refresh that ran and ended the session has logged its verdict. Its 401 is not logged as a response.
          // A 401 is never sent again, so the result is final.
          if (session.writer.generation() !== generation)
            return toResult<Res, O, M>(sent, operation)
          // With no session to refresh, classify the 401 as it is. It is logged as a response, as in the Unity SDK.
        }

        const result = toResult<Res, O, M>(sent, operation)
        // A business result decided by the server is never sent again, whatever the status code. Business errors can come as 5xx.
        const decided = result.kind === 'outcome' || result.kind === 'unknownOutcome'
        const delay =
          operation.retry === false || decided
            ? null
            : retryDelay(sent, idempotent, attempt, random, now, ctx.retryPolicy)
        if (delay === null) {
          // Without a response, `result` is the failure that `refused` gave for the reason.
          return sent.kind === 'response'
            ? log.responded(result, sent)
            : log.ended(result as Failure)
        }
        if (delay === RETRY_AFTER_TOO_LONG) {
          // The server asked for a longer wait than the cap. End now, as the Unity SDK does.
          // `delayMs` is the wait the server asked for. Only a response can ask for one.
          log.retryAfterTooLong(
            attempt,
            sent.kind === 'response' ? parseRetryAfter(sent.retryAfter, now) : null,
          )
          return log.ended(
            failure(
              'ResourceExhausted',
              `Retry-After wait time exceeds maximum (${ctx.retryPolicy.retryAfterCapMs}ms).`,
              { externalCode: 'Net_RateLimited' },
            ),
          )
        }

        log.retry(attempt, delay)
        if (!(await sleep(ctx, delay, signal))) return log.ended(refused('cancelled'))
      }
    } finally {
      unlink()
    }
  }
}

/** A request whose URL and body are ready, before it takes a token. */
interface PreparedRequest {
  readonly kind: 'prepared'
  readonly url: string
  readonly body: string | undefined
  /** Body size in UTF-8 bytes when the operation asks for `keepalive`. */
  readonly keepaliveBytes: number | undefined
  readonly idempotencyKey: string | undefined
}

/**
 * Builds the URL and the body, and picks the idempotency key. It does this once per call, before the first attempt.
 * A path or origin that the SDK refuses is a `failure`. A body that cannot become JSON throws `AxylUsageError`.
 */
function prepareRequest(
  ctx: TransportContext,
  baseUrl: string,
  operation: Pick<AnyOperation, 'id' | 'path' | 'params' | 'ids' | 'keepalive' | 'idempotencyKey'>,
  req: unknown,
  options: CallOptions | undefined,
): PreparedRequest | Failure {
  const fields = req as Readonly<Record<string, unknown>> | undefined
  const url = buildUrl(baseUrl, operation, fields)
  if (typeof url !== 'string') return url

  const bodyField = operation.params?.body
  let body: string | undefined
  try {
    body =
      bodyField !== undefined
        ? stringifyWithIds(fields?.[bodyField] ?? {}, operation.ids?.request)
        : undefined
  } catch {
    // A value that cannot become JSON, such as a BigInt, a function or a circular reference, is an app code error.
    throw new AxylUsageError(
      `${operation.id} request body cannot be serialized to JSON. Pass plain values such as strings, numbers, arrays and objects.`,
    )
  }
  // Browsers count the body in UTF-8 bytes, not in string length.
  let keepaliveBytes: number | undefined
  if (operation.keepalive === true) {
    keepaliveBytes = body === undefined ? 0 : new TextEncoder().encode(body).length
  }
  const idempotencyKey = operation.idempotencyKey
    ? (options?.idempotencyKey ?? ctx.adapters.crypto.uuid())
    : undefined
  return { kind: 'prepared', url, body, keepaliveBytes, idempotencyKey }
}

/** The headers of one attempt. `Accept-Language` is read again for each attempt, because `setLanguage()` can change it. */
function buildHeaders(
  ctx: TransportContext,
  parts: {
    readonly trace: string
    readonly body: string | undefined
    readonly idempotencyKey: string | undefined
    readonly token: string | undefined
  },
): Record<string, string> {
  const language = ctx.language()
  return {
    'X-App-Id': ctx.appId,
    'X-Platform': PLATFORM,
    'X-SDK-Version': SDK_VERSION,
    ...(ctx.osVersion !== undefined && { 'X-OS-Version': ctx.osVersion }),
    traceparent: parts.trace,
    'X-Client-Session-Id': ctx.clientSessionId,
    ...(language !== undefined && { 'Accept-Language': language }),
    ...(parts.body !== undefined && { 'Content-Type': 'application/json' }),
    ...(parts.idempotencyKey !== undefined && { 'Idempotency-Key': parts.idempotencyKey }),
    ...(parts.token !== undefined && { Authorization: `Bearer ${parts.token}` }),
  }
}

/**
 * The log entries of one call. Logs follow the Unity SDK, whose logging sits outside its retry loop.
 * A send through the pipeline logs its request once, then its final state once, after any retries.
 * The send after a 401 and a refresh is a new send. The 401 that started the refresh is not logged.
 *
 * The app logger runs inside the call, so it can cancel or call `dispose()` while it gets an entry.
 * A call that is stopped once its end is logged ends as cancelled, like any call stopped before it returns.
 * Its end is not logged again. `stopped` tells whether the app's `signal` or `dispose()` stopped the call.
 */
function createCallLog(
  ctx: TransportContext,
  operation: Pick<AnyOperation, 'id' | 'method'>,
  stopped: () => boolean,
) {
  const { log } = ctx
  const now = () => ctx.adapters.clock.now()
  /** `true` once the current send went out at least once. Its end is then logged. */
  let sent = false
  let startedAt = 0
  let traceId = ''
  let lastAttempt = 0
  /** The only place where a stop during the end entry turns the result into a cancel. */
  const afterEnd = <R>(result: R): R | Failure => (stopped() ? refused('cancelled') : result)

  return {
    get sent() {
      return sent
    },
    /** Records an attempt. The first attempt of a send logs the request at `info`. */
    sending(attempt: number, trace: string): void {
      if (!sent) {
        sent = true
        startedAt = now()
        traceId = trace
        log('info', 'request', { operation: operation.id, method: operation.method, traceId })
      }
      lastAttempt = attempt
    },
    /** Starts a new send after a 401 and a refresh. Its first attempt logs a new request. */
    newPass(): void {
      sent = false
    },
    /**
     * Ends a call that stops before it sends anything, and logs why at `warn`.
     * The Unity SDK does the same for a missing call credential and a full refresh queue.
     * A header it cannot send is a web case: `fetch` would throw, so the call ends here at the same level.
     * The message is the SDK's fixed text for that reason. It never holds a token.
     * A call that was already stopped keeps this reason. Only a stop from the logger turns it into a cancel.
     */
    notSent(result: Failure): Failure {
      const stoppedBefore = stopped()
      log('warn', 'request not sent', {
        operation: operation.id,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      })
      return stoppedBefore ? result : afterEnd(result)
    },
    /** Logs a send that ended with a response, at `info`. */
    responded<R>(result: R, response: { readonly status: number; readonly traceId: string }) {
      log('info', 'response', {
        operation: operation.id,
        statusCode: response.status,
        attempt: lastAttempt,
        durationMs: now() - startedAt,
        traceId: response.traceId,
      })
      return afterEnd(result)
    },
    /**
     * Logs a send that ended without a usable response, at `warn`: no response, a cancel, or a refused wait.
     * The server may still have received the request, so the trace ID that was sent is kept.
     * A call stopped before this point, such as from the logger during an earlier entry, ends as cancelled.
     * A call that `dispose()` stopped is not logged. The client has already logged that it was disposed.
     */
    ended(reason: Failure): Failure {
      const result = stopped() ? refused('cancelled') : reason
      if (ctx.lifetime.aborted) return result
      log('warn', 'transport error', {
        operation: operation.id,
        errorCode: result.error.code,
        errorMessage: result.error.message,
        attempt: lastAttempt,
        durationMs: now() - startedAt,
        traceId,
      })
      return afterEnd(result)
    },
    /** Logs a wait before the next attempt, at `info`. */
    retry(attempt: number, delayMs: number): void {
      log('info', 'retry', { operation: operation.id, attempt, delayMs })
    },
    /** Logs a `Retry-After` wait over the limit, at `warn`. `asked` is the wait the server asked for, if a response asked. */
    retryAfterTooLong(attempt: number, asked: number | null): void {
      log('warn', 'retry-after exceeds the limit', {
        operation: operation.id,
        attempt,
        ...(asked !== null && { delayMs: asked }),
      })
    },
  }
}

/**
 * The API server does not redirect. All redirects are refused so credentials in headers or body never go elsewhere.
 * With `keepaliveBytes`, the attempt goes out as `keepalive` if the bytes fit in the client's budget.
 * The bytes are given back when the attempt ends, whether it got a response, failed, was cancelled or timed out.
 * The response `traceId` is the server's `X-Trace-Id` when that value is a W3C trace ID.
 * Otherwise it is the trace ID sent in `traceparent`, as in the Unity SDK.
 */
async function sendOnce(
  ctx: TransportContext,
  r: Omit<HttpRequest, 'signal' | 'redirect' | 'keepalive'>,
  signal: AbortSignal,
  traceId: string,
  keepaliveBytes?: number,
): Promise<Sent> {
  const { adapters } = ctx
  const ctrl = new AbortController()
  let timedOut = false
  const unlink = linkSignals(ctrl, [signal])
  const timer = adapters.clock.setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ctx.retryPolicy.attemptTimeoutMs)
  const release = keepaliveBytes === undefined ? undefined : ctx.keepalive.reserve(keepaliveBytes)

  try {
    const res = await adapters.transport.send({
      ...r,
      redirect: 'error',
      signal: ctrl.signal,
      ...(release !== undefined && { keepalive: true }),
    })
    const body = await res.text()
    const echoed = res.header('X-Trace-Id')
    return {
      kind: 'response',
      status: res.status,
      body,
      traceId: echoed !== null && TRACE_ID.test(echoed) ? echoed : traceId,
      retryAfter: res.header('Retry-After'),
    }
  } catch {
    if (timedOut) return { kind: 'timeout' }
    if (ctrl.signal.aborted) return { kind: 'cancelled' }
    if (!adapters.environment.isOnline()) return { kind: 'offline' }
    return { kind: 'network' }
  } finally {
    release?.()
    adapters.clock.clearTimeout(timer)
    unlink()
  }
}

function toResult<Res, O extends string, M>(
  sent: Sent,
  operation: ClassifyOperation,
): AxylResult<Res, O, M> {
  return sent.kind === 'response' ? classify<Res, O, M>(sent, operation) : refused(sent.kind)
}

/** Resolves `true` after the wait, or `false` if cancelled meanwhile. */
function sleep(ctx: TransportContext, ms: number, signal: AbortSignal): Promise<boolean> {
  const { clock } = ctx.adapters
  return abortable(signal, false, (settle) => {
    const timer = clock.setTimeout(() => settle(true), ms)
    return () => clock.clearTimeout(timer)
  })
}
