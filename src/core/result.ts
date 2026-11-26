import type { HiveError, HiveErrorCode } from './errors'
import { parseWithIds, responsePaths } from './int64'
import { isRecord } from './json'
import type { AnyOperation } from './operation'

interface ResultBase {
  /**
   * The W3C trace ID of the request (32 lowercase hex characters). Include it when you report a problem.
   * It is present when the SDK classified a server response.
   * It is absent when no response arrived, such as on a timeout, a network error or a cancel at any point.
   * It is also absent when a token refresh ended the call, when a session change between attempts ended it,
   * and when a `Retry-After` wait over the limit ended it.
   */
  readonly traceId?: string
  /**
   * The raw response body.
   * Use it to read fields that this SDK version does not know yet.
   * It is absent for APIs whose response contains credentials.
   * For APIs whose request contains credentials, it is absent unless the call succeeded.
   */
  readonly raw?: string
}

/**
 * The call succeeded.
 * `M` is the shape of the response `meta`. Only APIs whose specification defines `meta` give it a type, such as the mailbox list cursor.
 */
export interface Success<T, M = unknown> extends ResultBase {
  readonly kind: 'success'
  /** The response data. */
  readonly data: T
  /** The response metadata, such as a paging cursor. */
  readonly meta?: M
}

/**
 * The server returned a business result that the API declares, such as an expired coupon.
 * It is not an error. Handle each `code` as part of your game logic.
 */
export interface Outcome<O extends string> extends ResultBase {
  readonly kind: 'outcome'
  /** The business result code. */
  readonly code: O
  /**
   * The value of an outcome that carries data. It is absent for outcomes without data.
   * It is also absent for APIs whose response contains credentials.
   */
  readonly data?: unknown
}

/**
 * The server returned a business result that this SDK version does not know.
 * The server may add new results. Handle this case in a default branch.
 */
export interface UnknownOutcome extends ResultBase {
  readonly kind: 'unknownOutcome'
  /** The business result code from the server. */
  readonly code: string
}

/** The call failed because of the network, the server, or the browser environment. */
export interface Failure {
  readonly kind: 'failure'
  /** The cause of the failure. */
  readonly error: HiveError
  /**
   * The raw response body. It is absent when there was no response or the response contains credentials.
   * It is also absent when the request contained credentials, whatever the status.
   */
  readonly raw?: string
}

/**
 * The return type of every module method.
 * Branch on `kind`:
 * - `success`: the call succeeded. Read `data`.
 * - `outcome`: the server returned a declared business result. Read `code`.
 * - `unknownOutcome`: the server returned a business result this SDK version does not know. Read `code`.
 * - `failure`: the call failed. Read `error`.
 *
 * @example
 * const result = await axyl.coupon.redeemCoupon({ body: { couponCode } })
 * switch (result.kind) {
 *   case 'success': openMail(result.data.mailId); break
 *   case 'outcome': showCouponMessage(result.code); break
 *   case 'unknownOutcome': showGenericMessage(); break
 *   case 'failure': console.warn(result.error.code, result.error.traceId); break
 *   default: showGenericMessage() // New result kinds may be added in later versions.
 * }
 */
export type AxylResult<T, O extends string = never, M = unknown> =
  Success<T, M> | Outcome<O> | UnknownOutcome | Failure

export const failure = (
  code: HiveErrorCode,
  message: string,
  extra: Omit<HiveError, 'code' | 'message'> = {},
): Failure => ({ kind: 'failure', error: { code, message, ...extra } })

/** A response passed to `classify`. The body is already read as a string. */
export interface RawResponse {
  readonly status: number
  readonly body: string
  /** The trace ID that the transport chose for this response. `classify` does not read one from the body. */
  readonly traceId?: string
}

/** The cause code for each HTTP status. Other 4xx statuses map to `Unknown`. Any other status maps to `Internal`. */
const STATUS_CODE: Readonly<Record<number, HiveErrorCode>> = {
  400: 'InvalidArgument',
  401: 'Unauthenticated',
  403: 'PermissionDenied',
  404: 'NotFound',
  409: 'AlreadyExists',
  422: 'InvalidArgument',
  429: 'ResourceExhausted',
  500: 'Internal',
  501: 'Unimplemented',
  502: 'Unavailable',
  503: 'Unavailable',
  504: 'DeadlineExceeded',
}

const statusToCode = (status: number): HiveErrorCode =>
  STATUS_CODE[status] ?? (status >= 400 && status < 500 ? 'Unknown' : 'Internal')

const parseJson = (s: string, ids: ReadonlySet<string>): unknown => {
  if (s === '') return undefined
  try {
    return parseWithIds(s, ids)
  } catch {
    return PARSE_ERROR
  }
}
const PARSE_ERROR = Symbol('parse-error')

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Longest server text kept in an error, as in the Unity SDK. Longer text is cut and ends with `...`. */
const MAX_ERROR_TEXT = 256

/**
 * The problem `type` shape in the server specifications: `/errors/{area}/{name}`,
 * where each part holds lowercase letters, digits and `-`. An example is `/errors/common/missing-field`.
 * A token never fits it, because tokens hold uppercase letters, `.` or `_`.
 */
const PROBLEM_TYPE = /^\/errors\/[a-z0-9-]+\/[a-z0-9-]+$/
/** Cuts server or provider text longer than the limit and ends it with `...`. */
export const cut = (s: string): string =>
  s.length <= MAX_ERROR_TEXT ? s : `${s.slice(0, MAX_ERROR_TEXT)}...`

/**
 * Sorts a response into the four result kinds. The order matches the Unity SDK.
 * 1. A 2xx status is `success`. A body that cannot be parsed is `failure` with `Internal`.
 * 2. If the body has a `code`, check the declared `outcomes` first. Some APIs declare a common code name as a business result.
 * 3. Next, a code in this API's `failures` is `failure`.
 * 4. Otherwise, the body decides. An `outcome` key, even with a `null` value, means `unknownOutcome`. No key means `failure`.
 *    The server always adds the `outcome` key to business errors and never to common errors.
 *    The HTTP status does not decide, because business errors also use 409, 422, and 500.
 * 5. Without a `code`, the HTTP status decides the `failure`. `externalCode` is `HTTP 404` and so on, and `Net_RateLimited` for 429.
 * The message comes from `detail`, then `title`, then a body that is not an object, then `HTTP 404` and so on.
 * Server text is cut at 256 characters. These rules match the Unity SDK.
 * For an API whose request or response holds credentials, a failure keeps no server text.
 * Its `externalCode` is the `code` only when the API declares that code. Otherwise it is `HTTP 404` and so on.
 * Its `type` is kept only when it has the `/errors/{area}/{name}` shape of the specifications.
 */
export function classify<T, O extends string, M = unknown>(
  res: RawResponse,
  operation: ClassifyOperation,
): AxylResult<T, O, M> {
  const redaction = redactionOf(operation)
  const parsed = parseJson(res.body, responsePaths(operation.ids?.response))
  if (res.status >= 200 && res.status < 300) return successOf<T, M>(res, parsed, redaction)
  const problem = isRecord(parsed) ? parsed : undefined
  if (problem !== undefined) {
    const business = businessOf<O>(res, problem, operation, redaction)
    if (business !== undefined) return business
  }
  return failureOf(res, problem, operation, redaction)
}

/** The fields of an operation that `classify` reads. */
export type ClassifyOperation = Pick<
  AnyOperation,
  'outcomes' | 'failures' | 'sensitiveResponse' | 'sensitiveRequest' | 'ids'
>

/** Which server text a result may keep. */
interface Redaction {
  /**
   * `false` when the response can hold credentials (`sensitiveResponse`).
   * A success then has no `raw`, and an outcome has no value.
   */
  readonly responseText: boolean
  /**
   * `false` when the request or the response can hold credentials.
   * An error body can repeat the request, so any result other than a success keeps no `raw`.
   * A failure keeps no free text from the server, such as the message or `instance`.
   */
  readonly errorText: boolean
}

function redactionOf(operation: ClassifyOperation): Redaction {
  const responseText = !operation.sensitiveResponse
  return { responseText, errorText: responseText && !operation.sensitiveRequest }
}

const traceOf = (res: RawResponse) => (res.traceId !== undefined ? { traceId: res.traceId } : {})

const errorRawOf = (res: RawResponse, redaction: Redaction) =>
  redaction.errorText ? { raw: res.body } : {}

/** A 2xx response. A body that is not a JSON object is a `failure` with `Internal`. */
function successOf<T, M>(
  res: RawResponse,
  parsed: unknown,
  redaction: Redaction,
): Success<T, M> | Failure {
  const tracePart = traceOf(res)
  if (parsed === PARSE_ERROR || (parsed !== undefined && !isRecord(parsed))) {
    // A broken success body is still a failure, so it follows the failure rule for `raw`.
    return {
      ...failure('Internal', 'Malformed success response.', tracePart),
      ...errorRawOf(res, redaction),
    }
  }
  return {
    kind: 'success',
    // A specified `data: null` (success without a body) stays `null`. Only an empty body gives `undefined`.
    data: (parsed === undefined ? undefined : parsed['data']) as T,
    ...(parsed !== undefined && 'meta' in parsed && { meta: parsed['meta'] as M }),
    ...tracePart,
    ...(redaction.responseText && { raw: res.body }),
  }
}

/**
 * A business result: a `code` that the API declares as an outcome, or an undeclared `code` with an `outcome` key.
 * Returns `undefined` when the body is not a business result.
 */
function businessOf<O extends string>(
  res: RawResponse,
  problem: Readonly<Record<string, unknown>>,
  operation: ClassifyOperation,
  redaction: Redaction,
): Outcome<O> | UnknownOutcome | undefined {
  const code = str(problem['code'])
  if (code === undefined) return undefined
  // The trace ID comes only from the transport, as in the Unity SDK. A `trace_id` in the error body is not read.
  const errorBase = { ...traceOf(res), ...errorRawOf(res, redaction) }
  if (operation.outcomes.includes(code)) {
    return {
      kind: 'outcome',
      code: code as O,
      // The server puts the value of an outcome in the `outcome` field of the error body, as the Unity SDK reads it.
      // An outcome without a value arrives as `outcome: null`. Then `data` is left out.
      // A response that can hold credentials keeps neither `raw` nor the outcome value.
      ...(redaction.responseText && problem['outcome'] != null && { data: problem['outcome'] }),
      ...errorBase,
    }
  }
  if (!operation.failures.includes(code) && 'outcome' in problem) {
    return { kind: 'unknownOutcome', code, ...errorBase }
  }
  return undefined
}

/** Any other response. `problem` is the body when it is a JSON object. */
function failureOf(
  res: RawResponse,
  problem: Readonly<Record<string, unknown>> | undefined,
  operation: ClassifyOperation,
  redaction: Redaction,
): Failure {
  // An operation marked `sensitiveResponse` or `sensitiveRequest` does not pass the server's free text on in a failure.
  // Its requests or responses carry credentials, and the text could repeat one. A declared `code`, `type` and `traceId` still identify the problem.
  const freeText = redaction.errorText
  const code = str(problem?.['code'])
  // A body that is not a JSON object, such as an HTML error page, becomes the message as it is.
  const plainBody = problem === undefined ? res.body : undefined
  const text = freeText
    ? (str(problem?.['detail']) ?? str(problem?.['title']) ?? plainBody)
    : undefined
  const message = text !== undefined && text !== '' ? cut(text) : `HTTP ${res.status}`
  // The specifications give every problem type the shape `/errors/{area}/{name}`.
  // For an operation that carries credentials, keep only a `type` of that shape, so free text cannot pass through it.
  const rawType = str(problem?.['type'])
  const type =
    freeText || (rawType !== undefined && PROBLEM_TYPE.test(rawType)) ? rawType : undefined
  const instance = freeText ? str(problem?.['instance']) : undefined
  // A `code` is server text too. For such an operation, keep it only if the specification declares it.
  // An undeclared code then falls back to the status, like a body without a `code`.
  const knownCode =
    code !== undefined && (freeText || operation.failures.includes(code)) ? code : undefined
  return {
    kind: 'failure',
    error: {
      code: statusToCode(res.status),
      message,
      externalCode:
        knownCode !== undefined
          ? cut(knownCode)
          : res.status === 429
            ? 'Net_RateLimited'
            : `HTTP ${res.status}`,
      ...traceOf(res),
      ...(type !== undefined && { type: cut(type) }),
      ...(instance !== undefined && { instance: cut(instance) }),
    },
    ...errorRawOf(res, redaction),
  }
}
