import type { IdPaths } from './int64'

/** How a request is authenticated. */
export type Credential =
  /** The access token of the current session. On 401 the SDK refreshes once and sends again. */
  | 'session'
  /** No token. Used by APIs called before sign-in. A 401 does not trigger a refresh. */
  | 'anonymous'
  /** The token the caller passed in `CallOptions.accessToken`. A 401 does not trigger a refresh. */
  | 'caller'

/**
 * An enum value from a server response.
 * Known values appear in autocompletion. The type stays correct when the server adds a new value.
 * Handle unknown values in a default branch. The Unity SDK receives them as `Unspecified` for the same reason.
 * Request enums stay closed so that invalid values are rejected.
 */
export type OpenEnum<T extends string> = T | (string & {})

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * The call information of one server API. It copies the specification YAML as is and has no logic.
 * The contract test compares these fields with the YAML.
 */
export interface Operation<Req, Res, O extends string, M = unknown> {
  /** The `operationId` from the specification. The contract test uses it as the key. */
  readonly id: string
  readonly method: HttpMethod
  /** The path template. Example: '/mailbox/v1/mail/{mailId}' */
  readonly path: string
  readonly credential: Credential
  /** Which request fields go to the path, the query, and the body. Absent for APIs without arguments. */
  readonly params?: {
    readonly path?: readonly string[]
    readonly query?: readonly string[]
    /**
     * The names in `query` that the specification marks `required: true`.
     * A required query whose value is an empty string is sent as `name=`, so the server validates the value itself.
     * An optional query whose value is an empty string is not sent.
     * A query whose value is an object is not listed. Its fields are sent as separate queries, so no query has its name.
     */
    readonly requiredQuery?: readonly string[]
    /** The name of the field sent as the body. */
    readonly body?: string
  }
  /** The paths of int64 ID fields. They are `string` in public types and numbers in JSON. */
  readonly ids?: IdPaths
  /**
   * `true` only when the specification declares an `Idempotency-Key` header. The SDK then sends one key per call.
   * The header does not make a request idempotent. The SDK cannot know that the server drops duplicates by key,
   * so a POST or PATCH with this header is still not sent again after a 5xx or a connection error.
   */
  readonly idempotencyKey?: true
  /** `true` when the response contains credentials such as tokens, so the result `raw` must be empty. */
  readonly sensitiveResponse?: true
  /**
   * `true` when the request contains credentials such as a password hash, a provider token or a grant key.
   * A non-2xx response then keeps neither `raw` nor the server's free text, because the server could repeat the request in it.
   */
  readonly sensitiveRequest?: true
  /** The business result codes the specification declares. */
  readonly outcomes: readonly O[]
  /**
   * The codes the specification declares as common errors for this API. They are `failure`, not business results, even with a `code`.
   * The list differs by specification. auth and token have 3, service has 2, tcb has 0, and the rest use the 14 in `STANDARD_FAILURES`.
   */
  readonly failures: readonly string[]
  /**
   * When `false`, the transport never sends the request again. Used for token refresh.
   * A refresh token becomes invalid as soon as it is used, so a resend would be rejected.
   */
  readonly retry?: false
  /**
   * When `true`, the transport asks the browser to keep the request alive after the tab closes.
   * It is an SDK mark, not part of the specification. Used for logs sent while the page unloads.
   * Browsers limit the bodies of such requests in progress to 64 KiB in total.
   * The SDK counts the body bytes of its own requests for each client.
   * A request that would go over the limit is sent without `keepalive`.
   * Only the request itself is kept alive.
   * If it gets a 401 while the page unloads, the token refresh and the resend can be cancelled with the page.
   */
  readonly keepalive?: true
  /** Carries the types only. It has no run-time value. */
  readonly __types?: { readonly req: Req; readonly res: Res; readonly meta: M }
}

export type AnyOperation = Operation<unknown, unknown, string>

/**
 * A helper that fixes the type arguments and then infers `outcomes` as literals.
 * Write it as op<Req, Res>()({ ... }). For an API with a known `meta` shape, write op<Req, Res, Meta>().
 */
export const op =
  <Req, Res, M = unknown>() =>
  <const O extends string>(o: Operation<Req, Res, O, M>): Operation<Req, Res, O, M> =>
    Object.freeze(o)

/** GET, PUT and DELETE are idempotent. POST and PATCH are not, even with an `Idempotency-Key` header. */
export const isIdempotent = (o: Pick<AnyOperation, 'method'>): boolean =>
  o.method === 'GET' || o.method === 'PUT' || o.method === 'DELETE'
