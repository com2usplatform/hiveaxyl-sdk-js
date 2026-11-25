import { abortable } from './abort'
import { AxylUsageError } from './errors'
import { callApp, withCategory, type Log } from './log'
import { isTransportFailure, refused, type TokenRefusal, type TransportFailure } from './refusal'
import type { Failure } from './result'

/** Session values. They live in memory only and never go to browser storage. */
export interface SessionTokens {
  readonly accessToken: string
  /**
   * Every sign-in method returns a refresh token.
   * If it is still `null`, the SDK does not refresh. A 401 goes back to the caller, and the session stays.
   */
  readonly refreshToken: string | null
  readonly playerId: string
  /** Expiry time in epoch milliseconds. `0` means unknown. */
  readonly expiresAt: number
}

/** Verdict of a refresh function. It has the same branches as the Unity SDK refresh handler. */
export type RefreshVerdict =
  | {
      readonly kind: 'renewed'
      readonly accessToken: string
      readonly refreshToken: string
      readonly expiresAt: number
    }
  /** The server rejected the refresh token (`invalid_grant_refresh_token`). The session ends. */
  | { readonly kind: 'rejected'; readonly message: string }
  /**
   * No verdict, for example a network error or a 5xx. The session stays.
   * `transport` is set when the refresh request got no response at all.
   */
  | { readonly kind: 'failed'; readonly message: string; readonly transport?: TransportFailure }
  | { readonly kind: 'cancelled' }

/** Refresh function that the `auth` module hands to the core when it is registered. */
export type Refresher = (refreshToken: string, signal: AbortSignal) => Promise<RefreshVerdict>

/**
 * Result of a refresh.
 * `halted` means refreshes failed without a verdict too many times in a row.
 * The SDK stopped refreshing and ended the session.
 * `unauthenticated` means the server rejected the refresh token, and the session ended.
 * It also means the session has no refresh token or no refresh function. Then the session stays.
 * `sessionChanged` means a sign-in or sign-out happened during the refresh, so its result was dropped.
 * A `TransportFailure` comes only from a refresh that started because the token expired.
 * That refresh got no response, and it does not count toward ending the session.
 */
type RefreshOutcome =
  | 'renewed'
  | 'unauthenticated'
  | 'sessionChanged'
  | 'failed'
  | 'halted'
  | 'cancelled'
  | TransportFailure

/** Sign-in state. It matches `isSignedIn()`. */
export type SessionState = 'signedIn' | 'signedOut'

/**
 * Why the sign-in state changed.
 * New values may be added. Handle unknown values in a default branch.
 * - `login`: a sign-in completed. It is sent even when the player was already signed in.
 * - `logout`, `withdrawn`, `passwordChanged`: the player signed out, deleted the account or changed the password.
 *   Each `auth` method says when it ends the session. A failed sign-out can also end it.
 * - `refreshRejected`: the server rejected the refresh token, so the session expired. The `expire` event carries the same reason.
 * - `refreshHalted`: refreshes kept failing without a verdict, so the session ended. No `expire` event is sent.
 */
export type SessionChangeReason =
  'login' | 'logout' | 'withdrawn' | 'passwordChanged' | 'refreshRejected' | 'refreshHalted'

/** Reason for a sign-out that the app requested and the server confirmed. `SessionWriter.clear` takes it. */
export type SessionClearReason = Extract<
  SessionChangeReason,
  'logout' | 'withdrawn' | 'passwordChanged'
>

/**
 * Session events and their values. Subscribe with `axyl.session.on()`.
 * Event values never contain tokens.
 * Event names are single lowercase words, like DOM events.
 * In the Unity SDK, `OnSessionExpired` and `OnSessionRefreshed` also fire on sign-out and sign-in.
 * They tell the app to delete or save a stored token.
 * The web SDK does not store tokens.
 * So `expire` and `tokenrefresh` fire only on expiry and refresh, and they have different names.
 */
export interface SessionEvents {
  /**
   * The SDK refreshed the access token. The sign-in state did not change.
   * `expiresAtMs` is the expiry time of the new access token in epoch milliseconds. `0` means unknown.
   */
  tokenrefresh: { readonly playerId: string; readonly expiresAtMs: number }
  /** The session expired because the server rejected the refresh token. */
  expire: { readonly reason: 'refreshRejected' }
  /**
   * Browser storage is not available, for example when the browser blocks site data or the page runs in a sandboxed iframe.
   * The device key now lives in memory and changes after a reload.
   * It is sent at most once per client.
   */
  storagefallback: { readonly reason: string }
  /**
   * The sign-in state changed. Use this one event to switch screens.
   * A token refresh does not change the state, so it does not send this event. `tokenrefresh` reports it.
   * Subscribing does not send the current state. Read it with `isSignedIn()`.
   * `dispose()` removes all listeners, so it does not send this event.
   * Listeners run before the call that confirmed the sign-in or sign-out returns.
   * See `SessionApi.on` before you start another sign-in or sign-out from a listener.
   */
  change: {
    /** State after the change. */
    readonly state: SessionState
    /** `playerId()` after the change. It is `null` when signed out. */
    readonly playerId: string | null
    /** Why the state changed. */
    readonly reason: SessionChangeReason
  }
}

/** Name of a session event. */
export type SessionEventName = keyof SessionEvents

/** Every session event name. `on()` checks the name against this list. The record type makes a new event fail to compile until it is listed. */
const SESSION_EVENTS: Readonly<Record<SessionEventName, true>> = {
  tokenrefresh: true,
  expire: true,
  storagefallback: true,
  change: true,
}
const SESSION_EVENT_NAMES: readonly string[] = Object.keys(SESSION_EVENTS)

/** One `on()` call. Each call is its own entry, so the same function added twice is called twice and removed one at a time. */
interface ListenerEntry {
  readonly fn: (v: never) => unknown
}

/**
 * The session as the app sees it. Read it from `axyl.session`.
 * The only way to get a token is `getAccessToken()`.
 * There is no way to get the refresh token.
 */
export interface SessionApi {
  /**
   * Adds a listener for a session event.
   * Returns a function that removes the listener.
   * Each call adds its own listener. The same function added twice is called twice, and each returned function removes one of them.
   * @throws {AxylUsageError} When `event` is not a session event name or `listener` is not a function.
   * A listener that throws does not stop other listeners or the SDK.
   * After `dispose()`, it does nothing.
   *
   * Subscribing does not send the current state. Read the starting state with `isSignedIn()`.
   * Some libraries emit the current state on subscribe, but this SDK does not.
   *
   * Listeners run synchronously, before the call that caused the event returns.
   * To start another sign-in or sign-out after that call, wait for the call's result instead.
   * Code that lets only one sign-in run at a time still counts that call as running in the listener,
   * and may reject a different call made there until that call ends.
   * `storagefallback` is the exception when browser storage is blocked from the start.
   * The SDK then sends it on a microtask after `createAxyl` returns.
   * Add that listener right after `createAxyl`, before any `await`, or you miss the event.
   *
   * The SDK ignores errors from a listener, including a rejected promise from an `async` listener.
   * Catch and report them in the listener if your game needs to know.
   *
   * @example
   * if (!axyl.session.isSignedIn()) showLoginScreen()
   * axyl.session.on('change', ({ state }) => {
   *   if (state === 'signedOut') showLoginScreen()
   * })
   */
  on<E extends SessionEventName>(event: E, listener: (value: SessionEvents[E]) => void): () => void
  /** Returns `true` while a player is signed in. */
  isSignedIn(): boolean
  /** Returns the signed-in player ID, or `null` when signed out. */
  playerId(): string | null
  /**
   * Returns `true` if the SDK keeps `deviceKey` in browser storage.
   * If `false`, the value lives in memory only and changes after a reload.
   * Use it when you missed the `storagefallback` event.
   */
  isStoragePersistent(): boolean
  /**
   * Returns the access token of the current session.
   * Pass it to your app server so the server can verify the player.
   * If a refresh is in progress, it waits for the refresh to finish.
   * If the access token has expired, it refreshes the token first.
   * For example, a tab that slept in the background gets a fresh token, not an expired one.
   * An unknown expiry time is not checked. While the browser is offline, it does not refresh early.
   * It returns `null` when no player is signed in.
   * It also returns `null` when the server rejected the token with 401.
   * After a refresh fails without a verdict, the session stays in this state.
   * `isSignedIn()` can still be `true` then.
   * It also returns `null` when another sign-in or sign-out completed while it waited.
   * Do not persist this value.
   * Do not put it in logs or error messages.
   */
  getAccessToken(): Promise<string | null>
}

/**
 * Result of a session commit.
 * - `committed`: the session changed.
 * - `disposed`: the client was disposed. The caller ends as cancelled, like any call cut short by `dispose()`.
 * - `stale`: another sign-in, sign-out or session end completed after the request started. The newer session stays.
 */
type SessionCommit = 'committed' | 'disposed' | 'stale'

/**
 * Returns the result of a call whose session commit `dispose()` refused: a `failure` (`Cancelled`), like any call cut short by it.
 * Returns `undefined` for any other commit result.
 */
export const cancelledIfDisposed = (commit: SessionCommit): Failure | undefined =>
  commit === 'disposed' ? refused('cancelled') : undefined

/**
 * Write access to the session. Only the modules that confirm sign-in and sign-out get it.
 * Read `generation()` before the server request and pass it back when you commit.
 * The commit is skipped if another sign-in or sign-out completed in between, or after `dispose()`.
 * The result tells which of the two happened.
 */
export interface SessionWriter {
  /** Current session generation. It changes on every sign-in, sign-out and session end. */
  generation(): number
  establish(tokens: SessionTokens, expected?: number): SessionCommit
  /**
   * Call after the server confirmed a sign-out, an account deletion or a password change.
   * A sign-out that failed for a reason other than cancellation also counts, because the player asked to sign out.
   * `reason` becomes the reason of the `change` event.
   */
  clear(expected: number | undefined, reason: SessionClearReason): SessionCommit
}

/**
 * Maximum number of requests that can wait for one refresh.
 * Only requests that arrive while the refresh runs count, as in the Unity SDK.
 * Requests that got a 401 and wait for the refresh they share do not count.
 */
export const MAX_REFRESH_WAITERS = 32

/**
 * Number of refreshes in a row that can fail without a verdict before the session ends.
 * It matches `k_MaxConsecutiveNoVerdictFailures` in Unity SDK 1.0.
 */
export const MAX_CONSECUTIVE_NO_VERDICT = 3

/**
 * The running refresh and the number of new requests that wait for it. Both are dropped together when the session changes.
 * Requests that got a 401 also wait, but they are not counted in `waiters`.
 */
interface InflightRefresh {
  readonly promise: Promise<RefreshOutcome>
  waiters: number
}

/**
 * The token put in a request and the session generation at that time.
 * After a 401, the request is sent again only if the generation is the same.
 * If another user signed in meanwhile, the old user's request is not sent with the new token.
 */
export interface RequestToken {
  readonly token: string | null
  readonly generation: number
  /**
   * Number of refreshes started before this token was taken.
   * After a 401, if a later refresh already finished, the request follows that verdict.
   * It does not start another refresh with the same refresh token.
   */
  readonly refreshEpoch: number
}

/** Hooks a `Session` reads from its client. Omitted items suit a test session. */
export interface SessionOptions {
  /** `true` when browser storage keeps values. Default: always `true`. */
  readonly storagePersistent?: () => boolean
  /** The current time in epoch milliseconds. Default: always `0`, so no token counts as expired. */
  readonly now?: () => number
  /** `false` when the browser reports that it is offline. Default: always `true`. */
  readonly online?: () => boolean
  /** The app's logger. Default: no logs. */
  readonly log?: Log
}

export class Session {
  #tokens: SessionTokens | null = null
  /** Grows on every sign-in and sign-out. A refresh result that arrives after it changed is dropped. */
  #generation = 0
  #inflight: InflightRefresh | null = null
  /** Number of refreshes started so far. It tells which refresh a request token predates. */
  #refreshEpoch = 0
  /** Refreshes in a row that failed without a verdict in this session. Reset on success or session change. */
  #noVerdict = 0
  /** `true` if the current access token got a 401. Reset on a successful refresh or session change. */
  #accessRejected = false
  #refresher: Refresher | null = null
  readonly #listeners = new Map<SessionEventName, Set<ListenerEntry>>()
  readonly #signal: AbortSignal
  readonly #storagePersistent: () => boolean
  /** The current time in epoch milliseconds. Without a clock, no token counts as expired. */
  readonly #now: () => number
  /** `false` when the browser reports that it is offline. */
  readonly #online: () => boolean
  /**
   * `false` after a refresh returned a token that had already expired by this clock.
   * The device clock is then ahead of the server, so the expiry time is treated as unknown.
   * Reset on a later refresh and on session change.
   */
  #expiryUsable = true
  /**
   * Writes session entries to the app's logger, such as a listener that threw or the storage warning.
   * Messages are fixed text and never hold a token or server text.
   */
  readonly #log: Log
  /** Writes token refresh entries. Same rules as `#log`. */
  readonly #refreshLog: Log
  /** Writes the entry of a request that waits for a refresh. The Unity SDK logs it from its transport pipeline. */
  readonly #waitLog: Log
  /** `true` once the storage warning went out. It goes out at most once per client. */
  #storageWarned = false

  constructor(
    signal: AbortSignal,
    {
      storagePersistent = () => true,
      now = () => 0,
      online = () => true,
      log = () => {},
    }: SessionOptions = {},
  ) {
    this.#signal = signal
    this.#storagePersistent = storagePersistent
    this.#now = now
    this.#online = online
    this.#log = withCategory(log, 'Session')
    this.#refreshLog = withCategory(log, 'TokenRefresh')
    this.#waitLog = withCategory(log, 'Transport')
  }

  setRefresher(fn: Refresher): void {
    if (this.#refresher) throw new AxylUsageError('A token refresher is already registered.')
    this.#refresher = fn
  }

  /**
   * Call right before a request that carries the session token. Waits while a refresh is in progress.
   * If no refresh is in progress and the access token has expired, it starts one and waits for it.
   * Concurrent calls share that refresh, so a tab that wakes up after a long sleep refreshes once.
   * The request that starts it does not count toward the queue limit, like a request that got a 401.
   * If that refresh fails without a verdict, it gives no token, and the request is not sent.
   * If that refresh got no response, it gives the cause instead, and the failure does not count toward ending the session.
   * While the browser is offline, it does not start that refresh. The request then fails as offline.
   * Gives no token if the session changed while waiting.
   * If `signal` is aborted while waiting, it leaves at once without waiting for the refresh.
   * Only a request logs that it waits and counts toward the queue limit.
   * `getAccessToken()` passes `request: false`, because it is not a request. So an app that reads the token often does not fill the queue for its requests.
   */
  async tokenForRequest(
    signal?: AbortSignal,
    { request = true }: { readonly request?: boolean } = {},
  ): Promise<RequestToken | TokenRefusal> {
    let inflight = this.#inflight
    let counted = request
    const expired = inflight ? null : this.#expiredRefreshToken()
    if (expired !== null) {
      // A cancelled request does not start a new refresh. The refresh token rotates on every use.
      if (signal?.aborted) return 'cancelled'
      inflight = this.#startRefresh(expired, 'expiry')
      counted = false
    }
    if (inflight) {
      if (counted && inflight.waiters >= MAX_REFRESH_WAITERS) return 'exhausted'
      // A request that arrives during another request's refresh waits for it. The Unity SDK logs this at `info`.
      if (counted && !signal?.aborted) this.#waitLog('info', 'request waits for token refresh')
      const generation = this.#generation
      const outcome = await this.#wait(inflight, signal, counted)
      // Return `cancelled` only when this request was cancelled. A refresh function that returned `cancelled` goes to the generation check below.
      if (outcome === 'cancelled' && signal?.aborted) return 'cancelled'
      // A halted refresh ends the session and changes the generation. So check `halted` before the generation.
      if (outcome === 'halted') return 'halted'
      if (generation !== this.#generation) {
        // A rejected refresh token ended the session that this request belongs to. As in the Unity SDK, that is a 401, not a session change.
        return outcome === 'unauthenticated' && this.#tokens === null
          ? 'sessionExpired'
          : 'sessionChanged'
      }
      if (outcome === 'failed') return 'failed'
      if (isTransportFailure(outcome)) return outcome
    }
    return this.currentToken()
  }

  /**
   * The current token, without waiting for a refresh or starting one.
   * The send after a 401 and a refresh uses it. The Unity SDK sends it without queueing again.
   */
  currentToken(): RequestToken {
    return {
      token: this.#tokens?.accessToken ?? null,
      generation: this.#generation,
      refreshEpoch: this.#refreshEpoch,
    }
  }

  /**
   * The token for a retry: the same token as the attempt before, stamped again at this send.
   * A retry sent after a refresh that ended without a verdict can then start a new refresh on its 401.
   * A refresh still running now started before this send, so it is not counted.
   */
  restamp(used: RequestToken): RequestToken {
    return { ...used, refreshEpoch: this.#refreshEpoch - (this.#inflight ? 1 : 0) }
  }

  /**
   * Records that a request with the session token got a 401. If that token is the current one, the app no longer gets it.
   * It does not start a refresh. The transport calls it when a request sent again with a refreshed token gets another 401.
   */
  markRejected(used: RequestToken): void {
    if (used.generation === this.#generation && this.#tokens?.accessToken === used.token) {
      this.#accessRejected = true
    }
  }

  /**
   * Call when a request with the session token got a 401. Concurrent calls share one refresh.
   * `used` is the token and generation of that request. A different generation means a sign-out or a new sign-in happened.
   * The same generation with a different token means another request already refreshed.
   * After `MAX_CONSECUTIVE_NO_VERDICT` failures in a row without a verdict, it ends the session and returns `halted`.
   */
  async refreshAfter401(used: RequestToken, signal?: AbortSignal): Promise<RefreshOutcome> {
    const current = this.#tokens
    // A 401 for a request from a sign-in that was replaced or ended. As in the Unity SDK, it does not refresh.
    if (used.generation !== this.#generation) return 'sessionChanged'
    if (!current) return 'unauthenticated'
    if (current.accessToken !== used.token) return 'renewed'
    this.markRejected(used)
    // A session without a refresh token cannot refresh. As in the Core specification and the Unity SDK,
    // the session stays and no event is sent. The 401 goes back to the caller as it is.
    if (current.refreshToken === null) return 'unauthenticated'
    if (!this.#refresher) return 'unauthenticated'
    let inflight = this.#inflight
    if (!inflight && used.refreshEpoch < this.#refreshEpoch) {
      // A refresh that started after this request ended without a verdict. The session and the token are unchanged.
      // Using the same refresh token again for this late 401 would count one more failure without a verdict.
      return 'failed'
    }
    // A cancelled request does not start a new refresh. The refresh token rotates on every use.
    if (!inflight && signal?.aborted) return 'cancelled'
    inflight ??= this.#startRefresh(current.refreshToken, '401')

    return this.#wait(inflight, signal, false)
  }

  /**
   * Returns the refresh token if the access token has expired and the session can refresh.
   * An expiry time of 0 means unknown, and it is not checked. A missed expiry is handled by the refresh after a 401.
   * There is no margin before the expiry time.
   * It is not checked while the browser is offline, because the refresh could not reach the server.
   */
  #expiredRefreshToken(): string | null {
    const t = this.#tokens
    if (!t || t.refreshToken === null || !this.#refresher) return null
    if (t.expiresAt === 0 || !this.#expiryUsable || !this.#online()) return null
    return this.#now() >= t.expiresAt ? t.refreshToken : null
  }

  /**
   * Starts the one shared refresh. Requests that come while it runs wait for it.
   * `cause` tells whether an expired token or a 401 started it.
   */
  #startRefresh(refreshToken: string, cause: 'expiry' | '401'): InflightRefresh {
    this.#refreshEpoch++
    // Share the refresh before it starts. The refresh request logs at once, and the app logger can then call
    // `getAccessToken()` or another API. Those calls must wait for this refresh, not start a second one with the same refresh token.
    let start!: () => void
    const created: InflightRefresh = {
      promise: new Promise((resolve) => {
        start = () => resolve(this.#runRefresh(refreshToken, cause))
      }),
      waiters: 0,
    }
    this.#inflight = created
    void created.promise.finally(() => {
      if (this.#inflight === created) this.#inflight = null
    })
    start()
    return created
  }

  /**
   * Waits for the refresh result. With `counted`, the caller counts as a waiter while it waits.
   * If `signal` is aborted, it returns `cancelled` at once and leaves the waiter count.
   * The refresh itself continues for other requests.
   */
  async #wait(
    inflight: InflightRefresh,
    signal: AbortSignal | undefined,
    counted: boolean,
  ): Promise<RefreshOutcome> {
    if (signal?.aborted) return 'cancelled'
    if (counted) inflight.waiters++
    try {
      if (!signal) return await inflight.promise
      return await abortable<RefreshOutcome>(signal, 'cancelled', (settle) => {
        void inflight.promise.then(settle)
        return () => {}
      })
    } finally {
      if (counted) inflight.waiters--
    }
  }

  async #runRefresh(refreshToken: string, cause: 'expiry' | '401'): Promise<RefreshOutcome> {
    const generation = this.#generation
    let verdict: RefreshVerdict
    let threw = false
    try {
      verdict = await this.#refresher!(refreshToken, this.#signal)
    } catch (e) {
      verdict = { kind: 'failed', message: e instanceof Error ? e.name : 'Refresh threw.' }
      threw = true
      this.#refreshLog('error', 'token refresh threw')
    }

    if (generation !== this.#generation) {
      // A sign-out or a new sign-in completed during the refresh. Drop the result and do not resend waiting requests.
      // The logs match the Unity SDK. A rejection or a failure is logged at `warn` as usual, without ending or counting.
      // A dropped success or rejection adds an `info`. A cancelled refresh is not logged, so `dispose()` adds nothing here.
      if (verdict.kind === 'rejected') this.#refreshLog('warn', 'token refresh rejected')
      if (verdict.kind === 'failed' && !threw) this.#refreshLog('warn', 'token refresh failed')
      if (verdict.kind === 'renewed' || verdict.kind === 'rejected') {
        this.#refreshLog('info', 'token refresh dropped: session changed')
      }
      return 'sessionChanged'
    }
    // The levels match the Unity SDK. The verdict message can carry a server result code, so the logs use fixed text only.
    switch (verdict.kind) {
      case 'renewed': {
        this.#refreshLog('info', 'token refreshed')
        // The app logger can call `dispose()`. Then the session is gone, so drop the result as above.
        if (generation !== this.#generation) return 'sessionChanged'
        this.#noVerdict = 0
        this.#accessRejected = false
        // A token that is already expired by this clock means the clock is ahead of the server.
        // Do not refresh it again before every request. A refresh after a 401 still works.
        this.#expiryUsable = verdict.expiresAt === 0 || verdict.expiresAt > this.#now()
        const prev = this.#tokens!
        this.#tokens = {
          accessToken: verdict.accessToken,
          refreshToken: verdict.refreshToken,
          playerId: prev.playerId,
          expiresAt: verdict.expiresAt,
        }
        this.#emit('tokenrefresh', { playerId: prev.playerId, expiresAtMs: verdict.expiresAt })
        return 'renewed'
      }
      case 'rejected':
        this.#refreshLog('warn', 'token refresh rejected: session expired')
        this.#end('refreshRejected')
        return 'unauthenticated'
      case 'cancelled':
        return 'cancelled'
      case 'failed':
        // A refresh that started early because the token expired, and got no response, is not a verdict on the session.
        // The token-expiry check is a web addition, so it must not end a session sooner than a 401 would.
        if (cause === 'expiry' && verdict.transport !== undefined) {
          this.#refreshLog('warn', 'token refresh failed', { kind: verdict.transport })
          return verdict.transport
        }
        // A refresh function that threw is already logged at `error`, and the Unity SDK adds no failure log for it.
        if (!threw) this.#refreshLog('warn', 'token refresh failed')
        this.#noVerdict++
        if (this.#noVerdict < MAX_CONSECUTIVE_NO_VERDICT) return 'failed'
        // As in Unity SDK 1.0, send only `change` and no `expire`. The Unity SDK logs both the failure and the halt.
        this.#refreshLog(
          'warn',
          `token refresh halted after ${MAX_CONSECUTIVE_NO_VERDICT} failures in a row without a verdict: session ended`,
        )
        this.#reset(null)
        this.#emitChange('refreshHalted')
        return 'halted'
    }
  }

  /** Session expiry. Sends `expire` first, then `change`. */
  #end(reason: SessionEvents['expire']['reason']): void {
    this.#reset(null)
    this.#emit('expire', { reason })
    this.#emitChange(reason)
  }

  /** Sends `change` with the session after the change. The value never contains a token. */
  #emitChange(reason: SessionChangeReason): void {
    const playerId = this.#tokens?.playerId ?? null
    this.#emit('change', {
      state: playerId === null ? 'signedOut' : 'signedIn',
      playerId,
      reason,
    })
  }

  /**
   * Call when the session changes: sign-in, sign-out, session end or dispose.
   * The running refresh belongs to the old session, so it is dropped with its waiter count.
   * Requests of the new session do not join it.
   * Requests that waited for the dropped refresh get its result, and the generation check discards it.
   * A halted refresh is the exception. It ends the session itself, and its waiters get `halted` before the generation check.
   */
  #reset(tokens: SessionTokens | null): void {
    this.#tokens = tokens
    this.#generation++
    this.#noVerdict = 0
    this.#accessRejected = false
    this.#expiryUsable = true
    this.#inflight = null
  }

  /**
   * Reports once per client that browser storage is not available and `deviceKey` lives in memory.
   * It logs a `warn` and sends `storagefallback`. It does nothing while storage keeps values.
   * With `deferEvent`, the event goes out on the next microtask, so an app that just created the client can add a listener first.
   */
  reportStorageFallback(reason: string, { deferEvent = false } = {}): void {
    if (this.#storageWarned || this.#storagePersistent()) return
    this.#storageWarned = true
    this.#log('warn', 'storage unavailable: deviceKey lives in memory')
    if (deferEvent) queueMicrotask(() => this.#emit('storagefallback', { reason }))
    else this.#emit('storagefallback', { reason })
  }

  #emit<E extends SessionEventName>(event: E, value: SessionEvents[E]): void {
    // A listener added during dispatch does not get this value. A listener removed during dispatch is not called.
    // If a listener calls `dispose()`, dispatch stops there.
    const set = this.#listeners.get(event)
    for (const entry of Array.from(set ?? [])) {
      if (this.#signal.aborted) return
      if (!set?.has(entry)) continue
      // An error in an app listener must not stop session handling.
      // It is logged at `warn`, as in the Unity SDK. The log names only the event, because the error is the app's.
      if (!callApp(() => (entry.fn as (v: SessionEvents[E]) => unknown)(value))) {
        this.#log('warn', `session ${event} listener threw`)
      }
    }
  }

  dispose(): void {
    this.#reset(null)
    this.#listeners.clear()
  }

  /** Checks whether a commit is allowed. It is not allowed after dispose or if the generation changed since the request. */
  #refusal(expected: number | undefined): Exclude<SessionCommit, 'committed'> | undefined {
    if (this.#signal.aborted) return 'disposed'
    if (expected !== undefined && expected !== this.#generation) return 'stale'
    return undefined
  }

  readonly writer: SessionWriter = Object.freeze({
    generation: () => this.#generation,
    establish: (tokens: SessionTokens, expected?: number): SessionCommit => {
      const refusal = this.#refusal(expected)
      if (refusal) return refusal
      this.#reset(Object.freeze({ ...tokens }))
      this.#emitChange('login')
      return 'committed'
    },
    clear: (expected: number | undefined, reason: SessionClearReason): SessionCommit => {
      const refusal = this.#refusal(expected)
      if (refusal) return refusal
      const wasSignedIn = this.#tokens !== null
      this.#reset(null)
      // If the player was already signed out, the state did not change, so no event is sent.
      if (wasSignedIn) this.#emitChange(reason)
      return 'committed'
    },
  })

  readonly api: SessionApi = Object.freeze({
    on: <E extends SessionEventName>(event: E, listener: (value: SessionEvents[E]) => void) => {
      // The types catch these. The checks are for JavaScript and `<script>` users.
      // A misspelled name would otherwise never fire, and a value that is not a function would fail on every event.
      if (typeof event !== 'string' || !SESSION_EVENT_NAMES.includes(event)) {
        throw new AxylUsageError(
          `session.on: unknown event "${String(event)}". Use one of ${SESSION_EVENT_NAMES.join(', ')}.`,
        )
      }
      if (typeof listener !== 'function') {
        throw new AxylUsageError('session.on: listener must be a function.')
      }
      if (this.#signal.aborted) return () => {}
      let set = this.#listeners.get(event)
      if (!set) this.#listeners.set(event, (set = new Set()))
      const entry: ListenerEntry = { fn: listener as (v: never) => unknown }
      set.add(entry)
      return () => {
        set.delete(entry)
      }
    },
    isSignedIn: () => this.#tokens !== null,
    playerId: () => this.#tokens?.playerId ?? null,
    isStoragePersistent: () => this.#storagePersistent(),
    getAccessToken: async () => {
      // Wait for the same refresh as requests, so dispose applies here too.
      // It does not count toward the queue limit, so reading the token often never makes a request fail as `exhausted`.
      // If the session changed while waiting for a refresh, return null. The old session's refresh result cannot be trusted.
      // If a new session commits in the short gap without a refresh wait, return its token. It belongs to the same user as `playerId()` at that time.
      // The Unity SDK reads its access token without waiting, so a wait here is not logged as a request.
      const t = await this.tokenForRequest(this.#signal, { request: false })
      if (typeof t === 'string') return null
      // Read the token and the rejected flag from the session after the wait. Never hand a token the server rejected with 401 to the app server.
      return this.#accessRejected ? null : (this.#tokens?.accessToken ?? null)
    },
  })
}
