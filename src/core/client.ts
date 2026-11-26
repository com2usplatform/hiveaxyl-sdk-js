import { SDK_VERSION } from '../version'
import type { AdapterFactories, Adapters, FeatureAdapters } from './adapters'
import { AxylUsageError } from './errors'
import { isAllowedBaseUrl } from './hosts'
import { createLog, withCategory, type Logger } from './log'
import {
  internalsOf,
  KNOWN_MODULES,
  isPrivilegedModule,
  type KnownModuleId,
  type ModuleFactory,
  type PrivilegedContext,
} from './module'
import { createPkce, deviceKeyOf, sha256Hex } from './crypto'
import { checkLanguage, own, retryPolicyOf, type NetworkOptions } from './options'
import { failure, type Failure } from './result'
import type { RetryPolicy } from './retry'
import { Session, type Refresher, type SessionApi } from './session'
import {
  createCaller,
  createKeepaliveBudget,
  osVersionHeader,
  type TransportContext,
} from './transport'

export type { NetworkOptions } from './options'

/**
 * Modules to register, keyed by module name. Each value is the module function's result, such as `auth()`.
 * Only registered modules appear on the client.
 */
export type ModuleMap = { readonly [K in KnownModuleId]?: ModuleFactory<K, object> }

type ApiOf<F> = F extends ModuleFactory<string, infer A> ? A : never

/**
 * The client that `createAxyl` returns.
 * Each registered module is a property, such as `axyl.mailbox`.
 * Reading a module that was not registered throws `AxylUsageError`.
 */
export type AxylClient<M extends ModuleMap> = {
  readonly [K in keyof M]-?: ApiOf<M[K]>
} & {
  /** Sign-in state, session events and the access token. */
  readonly session: SessionApi
  /**
   * Changes the `Accept-Language` header. It applies from the next request.
   * Pass `null` to go back to the browser language.
   * It matches `HiveCore.SetLanguage(string?)` in the Unity SDK.
   * A tag starts with a 2- or 3-letter language code. Subtags of 1 to 8 letters or digits follow, each after a `-`.
   * Throws `AxylUsageError` if the value is not `null` or a BCP 47 tag such as `"ko-KR"`, or if the client was disposed.
   */
  setLanguage(language: string | null): void
  /**
   * Shuts the client down.
   * Requests in progress end with a `failure` whose code is `Cancelled`.
   * This includes requests sent with `keepalive`, such as logs.
   * If you call `dispose()` when the tab closes, the requests still being sent are cancelled.
   * The session is cleared and all session listeners are removed. No `change` event is sent.
   * Calling a module method or `setLanguage()` afterwards fails with `AxylUsageError`:
   * a method that returns a promise rejects, and the others throw.
   * Calling it again does nothing.
   * When a development server reloads your code and you create a new client, dispose the old one first.
   * Otherwise the old client keeps its session and its pending requests.
   */
  dispose(): void
  /**
   * Returns `true` once `dispose()` ran on this client. It never throws.
   * Check it after each `await` in code that can outlive the client, such as a flow that spans several calls.
   * A call can still return `success` when a session listener called `dispose()` after the call had finished its work.
   * Module methods and `setLanguage()` called after `dispose()` fail with `AxylUsageError`.
   */
  isDisposed(this: void): boolean
}

/** Options for `createAxyl`. */
export interface AxylOptions<M extends ModuleMap> {
  /** App ID from the Hive Axyl console. An empty or whitespace-only value throws `AxylUsageError`. */
  readonly appId: string
  /**
   * Client ID from the Hive Axyl console. An empty or whitespace-only value throws `AxylUsageError`.
   * Never put the client secret in browser code.
   */
  readonly clientId: string
  /** Modules to register, such as `{ auth: auth(), coupon: coupon() }`. */
  readonly modules: M
  /**
   * Receives SDK logs. Without it, the SDK writes no logs.
   * Fields not on the SDK allow list are replaced with `'***'`.
   */
  readonly logger?: Logger
  /**
   * `Accept-Language` header. Without it, or with `null`, the SDK uses the browser language.
   * Change it later with `setLanguage()`. It follows the same rule as `setLanguage()`.
   */
  readonly language?: string | null
  /** Retry and timeout settings. Without it, the SDK uses the defaults. */
  readonly network?: NetworkOptions
  /**
   * Replaces browser adapters. Use it for tests or to change how the SDK uses a browser feature.
   * The SDK runs only in a browser page. It needs `window` and `document` even when you replace every adapter.
   * Omitted items use the default implementation.
   * The SDK uses `popup` and `webAuth` only when a registered module needs them. It creates their defaults only then.
   * No module uses `lifecycle` in this release.
   */
  readonly adapters?: Partial<Adapters & FeatureAdapters>
}

/**
 * Result of `createAxyl`.
 * `success` holds the client.
 * `failure` with `FailedPrecondition` means the browser cannot run the SDK.
 * On a page that is not a secure context (HTTPS or localhost), `externalCode` is `Env_InsecureContext`.
 * Without Web Crypto, `externalCode` is not set.
 * Invalid options throw `AxylUsageError` instead.
 */
export type CreateResult<C> = { readonly kind: 'success'; readonly client: C } | Failure

const FEATURE_NAMES: ReadonlySet<string> = new Set([
  'popup',
  'lifecycle',
  'webAuth',
] satisfies (keyof FeatureAdapters)[])

/**
 * Validates the options and creates a client. All state lives in this client. There is no global state.
 * App code errors throw. Problems with the runtime environment return a `failure`.
 */
export function createClient<M extends ModuleMap>(
  options: AxylOptions<M>,
  defaultAdapters: AdapterFactories,
): CreateResult<AxylClient<M>> {
  const settings = readOptions(options)
  const entries = checkModules(settings.modules)
  const overrides = own<Partial<Adapters & FeatureAdapters>>(options, 'adapters') ?? {}
  const adapters = pickAdapters(overrides, defaultAdapters)
  if (!isAdapters(adapters)) return adapters

  let language = settings.language
  const lifetime = new AbortController()
  const appLog = createLog(own<Logger>(options, 'logger'))
  const log = withCategory(appLog, 'Core')
  const session = new Session(lifetime.signal, {
    storagePersistent: () => adapters.storage.persistent,
    now: () => adapters.clock.now(),
    online: () => adapters.environment.isOnline(),
    log: appLog,
  })
  // If storage is blocked from the start, send the event on the next microtask so the app can add a listener first.
  session.reportStorageFallback('Web storage is not available.', { deferEvent: true })

  const transportLog = withCategory(appLog, 'Transport')
  const osVersion = osVersionHeader(adapters.environment, transportLog)
  const ctx: TransportContext = {
    appId: settings.appId,
    adapters,
    session,
    log: transportLog,
    lifetime: lifetime.signal,
    clientSessionId: adapters.crypto.uuid(),
    osVersion,
    retryPolicy: settings.retryPolicy,
    keepalive: createKeepaliveBudget(),
    // An empty browser language leaves the header out, as in the Unity SDK.
    language: () => language ?? (adapters.environment.language() || undefined),
    assertAlive: () => {
      if (lifetime.signal.aborted)
        throw new AxylUsageError(
          'This Hive Axyl client has been disposed. Create a new client with createAxyl.',
        )
    },
  }

  const client: Record<string, unknown> = {}
  const moduleLifetimes = bindModules(client, entries, {
    ctx,
    privileged: privilegedContext(settings.clientId, ctx, session),
    feature: featureAccess(overrides, ctx),
  })
  defineClientMethods(client, {
    session,
    setLanguage: (next) => {
      ctx.assertAlive()
      language = checkLanguage(next)
    },
    dispose: () => {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      for (const c of moduleLifetimes) c.abort()
      session.dispose()
      log('info', 'client disposed')
    },
    isDisposed: () => lifetime.signal.aborted,
  })

  log('info', 'client created')
  return { kind: 'success', client: Object.freeze(client) as AxylClient<M> }
}

/** The checked values of `createAxyl` options, other than the modules and the adapters. */
interface Settings<M extends ModuleMap> {
  readonly appId: string
  readonly clientId: string
  readonly modules: M
  readonly retryPolicy: RetryPolicy
  /** The language from the options. `undefined` means the browser language. */
  readonly language: string | undefined
}

/** Reads and checks the options. Only own properties count. A wrong value is an app code error. */
function readOptions<M extends ModuleMap>(options: AxylOptions<M>): Settings<M> {
  if (typeof options !== 'object' || options === null) {
    throw new AxylUsageError('createAxyl needs options: { appId, clientId, modules }.')
  }
  const appId = own<string>(options, 'appId')
  const clientId = own<string>(options, 'clientId')
  const modules = own<M>(options, 'modules')
  if (typeof appId !== 'string' || appId.trim() === '') {
    throw new AxylUsageError('appId is required. Use the App ID from the Hive Axyl console.')
  }
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new AxylUsageError('clientId is required. Use the Client ID from the Hive Axyl console.')
  }
  if (typeof modules !== 'object' || modules === null) {
    throw new AxylUsageError(
      'modules is required. Pass the modules you use, such as { auth: auth(), token: token() }.',
    )
  }
  const retryPolicy = retryPolicyOf(own<unknown>(options, 'network'))
  const initialLanguage = own<unknown>(options, 'language')
  const language = initialLanguage === undefined ? undefined : checkLanguage(initialLanguage)
  return { appId, clientId, modules, retryPolicy, language }
}

/** A registered module that passed the checks. */
interface ModuleEntry {
  readonly name: KnownModuleId
  readonly factory: ModuleFactory<string, object>
  readonly internals: NonNullable<ReturnType<typeof internalsOf>>
}

/** Checks each value in `modules`. A value that is not a module of this SDK copy and version is an app code error. */
function checkModules(modules: object): ModuleEntry[] {
  return Object.keys(modules).map((name) => {
    const factory = own<ModuleFactory<string, object>>(modules, name)
    if (typeof factory !== 'object' || factory === null) {
      throw new AxylUsageError(
        `"${name}" is not a Hive Axyl module. Pass the value a module function returns, such as auth().`,
      )
    }
    // Check the version before the marker. This gives the right message when the SDK is loaded twice.
    if (factory.sdkVersion !== SDK_VERSION) {
      throw new AxylUsageError(
        `Module "${name}" is ${String(factory.sdkVersion)} but core is ${SDK_VERSION}. Load one copy of the SDK.`,
      )
    }
    const internals = internalsOf(factory)
    if (!internals) {
      throw new AxylUsageError(
        `"${name}" is not a Hive Axyl module. If the SDK is loaded twice (for example ESM and CJS), load one copy.`,
      )
    }
    if (factory.id !== name) {
      throw new AxylUsageError(
        `Module key "${name}" does not match module "${factory.id}". Register it as ${factory.id}: ${factory.id}().`,
      )
    }
    if (!(KNOWN_MODULES as readonly string[]).includes(name)) {
      throw new AxylUsageError(
        `"${name}" is not a module this version of the SDK knows. Update the SDK or remove the module.`,
      )
    }
    if (!isAllowedBaseUrl(factory.baseUrl)) {
      throw new AxylUsageError(
        `Module "${name}" baseUrl is not an allowed Hive Axyl server. Leave baseUrl out to use the default server.`,
      )
    }
    return { name: name as KnownModuleId, factory, internals }
  })
}

const isAdapters = (value: Adapters | Failure): value is Adapters =>
  (value as Partial<Failure>).kind !== 'failure'

/**
 * Picks each required adapter: the app's replacement, or the browser default.
 * It checks the environment before it creates the other adapters.
 * On an HTTP page it returns before the storage probe writes to localStorage and before `fetch` is captured.
 */
function pickAdapters(
  overrides: Partial<Adapters>,
  defaultAdapters: AdapterFactories,
): Adapters | Failure {
  const pick = <K extends keyof Adapters>(k: K): Adapters[K] =>
    own<Adapters[K]>(overrides, k) ?? defaultAdapters[k]()
  const environment = pick('environment')
  if (!environment.isSecureContext()) {
    return failure(
      'FailedPrecondition',
      'Hive Axyl requires a secure context (HTTPS or localhost) with Web Crypto.',
      { externalCode: 'Env_InsecureContext' },
    )
  }
  if (!environment.hasWebCrypto()) {
    return failure(
      'FailedPrecondition',
      'Hive Axyl requires Web Crypto (`crypto.subtle`), and this browser does not provide it.',
    )
  }
  return Object.freeze({
    transport: pick('transport'),
    storage: pick('storage'),
    environment,
    crypto: pick('crypto'),
    clock: pick('clock'),
  })
}

/** The session write access and credential helpers that only the `auth` and `token` modules get. */
function privilegedContext(
  clientId: string,
  ctx: TransportContext,
  session: Session,
): PrivilegedContext {
  const { adapters } = ctx
  // The client keeps the same deviceKey for its whole life. It does not change even if storage becomes blocked later.
  let deviceKey: string | undefined
  return Object.freeze({
    clientId,
    session: session.writer,
    setRefresher: (fn: Refresher) => session.setRefresher(fn),
    assertAlive: () => ctx.assertAlive(),
    now: () => adapters.clock.now(),
    // Methods that send no request also throw after dispose(). A disposed client must not write to storage.
    newPkce: () => {
      ctx.assertAlive()
      return createPkce(adapters.crypto)
    },
    deviceKey: () => {
      ctx.assertAlive()
      deviceKey ??= deviceKeyOf(adapters.storage, adapters.crypto)
      // If storage became blocked during use and fell back to memory, report it now.
      session.reportStorageFallback('Web storage became unavailable.')
      return deviceKey
    },
    hashPassword: (raw: string) => {
      ctx.assertAlive()
      return sha256Hex(adapters.crypto, raw)
    },
  })
}

/**
 * Returns the function that gives a module an optional adapter.
 * Optional adapters from the app are captured at creation, like the required ones. Later changes to the options object are ignored.
 * If the app passed none, the first module that asks creates the default. Modules of the same client share one adapter.
 */
function featureAccess(overrides: Partial<FeatureAdapters>, ctx: TransportContext) {
  const features: { -readonly [K in keyof FeatureAdapters]?: FeatureAdapters[K] | undefined } = {
    popup: own<FeatureAdapters['popup']>(overrides, 'popup'),
    lifecycle: own<FeatureAdapters['lifecycle']>(overrides, 'lifecycle'),
    webAuth: own<FeatureAdapters['webAuth']>(overrides, 'webAuth'),
  }
  return <K extends keyof FeatureAdapters>(
    name: K,
    fallback: () => FeatureAdapters[K],
  ): FeatureAdapters[K] => {
    ctx.assertAlive()
    if (!FEATURE_NAMES.has(name))
      throw new AxylUsageError(`"${String(name)}" is not a feature adapter.`)
    return (features[name] ??= fallback())
  }
}

/**
 * Binds each module to this client and puts its API on `client`.
 * Reading a module that was not registered throws `AxylUsageError`.
 * Returns the lifetime controllers of the modules. `dispose()` aborts them.
 */
function bindModules(
  client: Record<string, unknown>,
  entries: readonly ModuleEntry[],
  shared: {
    readonly ctx: TransportContext
    readonly privileged: PrivilegedContext
    readonly feature: ReturnType<typeof featureAccess>
  },
): AbortController[] {
  // Each module gets its own lifetime signal instead of the core's.
  // An `AbortSignal` is an `EventTarget`, so a module holding the core signal could fire its abort listeners with `dispatchEvent`.
  const moduleLifetimes: AbortController[] = []
  for (const { name, factory, internals } of entries) {
    const moduleLifetime = new AbortController()
    moduleLifetimes.push(moduleLifetime)
    const base = {
      call: createCaller(shared.ctx, factory.baseUrl),
      feature: shared.feature,
      lifetime: moduleLifetime.signal,
    }
    let api: object
    if (!internals.privileged) {
      api = internals.bind(base)
    } else if (isPrivilegedModule(name)) {
      api = internals.bind({ ...base, privileged: shared.privileged })
    } else {
      throw new AxylUsageError(`Module "${name}" cannot receive session access.`)
    }
    Object.defineProperty(client, name, { value: Object.freeze(api), enumerable: true })
  }
  for (const name of KNOWN_MODULES) {
    if (Object.hasOwn(client, name)) continue
    Object.defineProperty(client, name, {
      get() {
        throw new AxylUsageError(
          `Module "${name}" is not registered. Add it to createAxyl modules.`,
        )
      },
      enumerable: false,
    })
  }
  return moduleLifetimes
}

/** Puts the client's own members on `client`: `session`, `setLanguage`, `dispose` and `isDisposed`. */
function defineClientMethods(
  client: Record<string, unknown>,
  members: {
    readonly session: Session
    readonly setLanguage: (next: unknown) => void
    readonly dispose: () => void
    readonly isDisposed: () => boolean
  },
): void {
  Object.defineProperty(client, 'session', { value: members.session.api, enumerable: true })
  Object.defineProperty(client, 'setLanguage', { value: members.setLanguage, enumerable: true })
  Object.defineProperty(client, 'dispose', { value: members.dispose, enumerable: true })
  Object.defineProperty(client, 'isDisposed', { value: members.isDisposed, enumerable: true })
}
