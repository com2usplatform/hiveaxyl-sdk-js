import { browserAdapters, hasBrowserGlobals } from './browser'
import {
  createClient,
  type AxylClient,
  type AxylOptions,
  type CreateResult,
  type ModuleMap,
} from './core/client'
import { AxylUsageError } from './core/errors'

/**
 * Creates a Hive Axyl SDK instance.
 * Register the modules you use in `modules`. Each one is then available by its key, such as `axyl.mailbox`.
 *
 * Returns `success` with the instance in `client`.
 * Returns `failure` with `FailedPrecondition` when the page is not a secure context (HTTPS or localhost) or lacks Web Crypto.
 * On a page that is not a secure context, `externalCode` is `Env_InsecureContext`.
 * Throws `AxylUsageError` when the options are invalid. Fix the app code in that case.
 *
 * Call it only in a browser.
 * It throws `AxylUsageError` during server rendering.
 * This stops one server process from sharing a single session among many users.
 *
 * @throws {AxylUsageError} When it runs outside a browser, such as during server rendering.
 * @throws {AxylUsageError} When `options` is not an object, or `appId`, `clientId` or `modules` is missing.
 * @throws {AxylUsageError} When `network` is not an object, or has an unknown key or a value that is not an integer in range.
 * @throws {AxylUsageError} When `language` is not `null` or a BCP 47 tag such as `"ko-KR"`.
 * @throws {AxylUsageError} When a value in `modules` is not a Hive Axyl module, its key does not match the module,
 *   its `baseUrl` is not an allowed Hive Axyl server, it comes from another copy or version of the SDK,
 *   or it asks for session access that only the `auth` and `token` modules get.
 *
 * @example
 * const created = createAxyl({
 *   appId,
 *   clientId,
 *   modules: { auth: auth(), token: token(), coupon: coupon() },
 * })
 * if (created.kind === 'failure') throw new Error(created.error.message)
 * const axyl = created.client
 */
export function createAxyl<const M extends ModuleMap>(
  options: AxylOptions<M>,
): CreateResult<AxylClient<M>> {
  if (!hasBrowserGlobals()) {
    throw new AxylUsageError(
      'createAxyl must be called in a browser, not during server rendering. Call it from client-side code.',
    )
  }
  return createClient(options, browserAdapters)
}

export { detectEnvironment } from './browser/environment'
export type { BrowserEnvironment, InAppBrowser } from './browser/environment'
export type { PaymentWindow, PaymentWindowResult } from './core/popup'
export { AxylUsageError } from './core/errors'
export { SDK_VERSION } from './version'
export type {
  AxylClient,
  AxylOptions,
  CreateResult,
  ModuleMap,
  NetworkOptions,
} from './core/client'
export type { HiveError, HiveErrorCode } from './core/errors'
export type { AxylResult, Success, Outcome, UnknownOutcome, Failure } from './core/result'
export type {
  SessionApi,
  SessionEvents,
  SessionEventName,
  SessionState,
  SessionChangeReason,
} from './core/session'
export type { CallOptions } from './core/transport'
export type { OpenEnum } from './core/operation'
export type { UserCanceled, PopupOptions } from './core/popup'
export type {
  WebAuthAdapter,
  SignInPopup,
  SignInRequest,
  SignInResult,
  SignInProtocol,
  AuthorizationValues,
  OAuthCallback,
  OpenIdCallback,
  RedirectSignIn,
  RedirectSignInRequest,
} from './core/webauth'
export type { Logger, LogLevel } from './core/log'
export type {
  Adapters,
  TransportAdapter,
  StorageAdapter,
  EnvironmentAdapter,
  CryptoAdapter,
  ClockAdapter,
  AdapterFactories,
  FeatureAdapters,
  PopupAdapter,
  PopupWindow,
  LifecycleAdapter,
  LifecycleEvent,
  HttpRequest,
  HttpResponse,
} from './core/adapters'
