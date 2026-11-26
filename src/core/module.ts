import { SDK_VERSION } from '../version'
import type { FeatureAdapters } from './adapters'
import type { Pkce } from './crypto'
import type { Refresher, SessionWriter } from './session'
import type { CallFn } from './transport'

/**
 * The module names the SDK knows. Add a name here when you add a feature module.
 * Accessing a module name that was not registered throws at run time, and this list makes that check possible.
 */
export const KNOWN_MODULES = Object.freeze([
  'auth',
  'token',
  'service',
  'mailbox',
  'analytics',
  'coupon',
  'tcb',
  'payment',
] as const)
export type KnownModuleId = (typeof KNOWN_MODULES)[number]

/**
 * The modules that may write the session or set the refresh function. Other modules receive only the request function.
 * It is not exported. An exported set could be extended with `add`.
 */
const PRIVILEGED_IDS = ['auth', 'token'] as const satisfies readonly KnownModuleId[]
type PrivilegedModuleId = (typeof PRIVILEGED_IDS)[number]
const PRIVILEGED_MODULES: ReadonlySet<KnownModuleId> = new Set(PRIVILEGED_IDS)

/** Returns `true` when the module may receive session write access. */
export function isPrivilegedModule(name: KnownModuleId): boolean {
  return PRIVILEGED_MODULES.has(name)
}

/** Options that every module registration function accepts. */
export interface ModuleOptions {
  /** The server URL. Without it, the module uses the default server from its specification. It must be an allowed Hive Axyl server. */
  readonly baseUrl?: string
}

/**
 * What a module receives. None of it reaches the session or the tokens.
 */
interface ModuleContext {
  readonly call: CallFn
  /**
   * Returns an optional adapter this module uses.
   * If the app passed one through the `adapters` option of `createAxyl`, it returns that one.
   * Otherwise it creates the default with `fallback`. Within one instance, the same name always returns the same adapter.
   */
  feature<K extends keyof FeatureAdapters>(
    name: K,
    fallback: () => FeatureAdapters[K],
  ): FeatureAdapters[K]
  /** Aborts on `dispose()`. Clean up the module's subscriptions and timers when it aborts. */
  readonly lifetime: AbortSignal
}

/**
 * Access given only to the auth and token modules. Each instance creates its own.
 * Passing the same registration result to two instances does not mix their sessions.
 */
export interface PrivilegedContext {
  readonly clientId: string
  readonly session: SessionWriter
  setRefresher(fn: Refresher): void
  /**
   * Throws `AxylUsageError` after `dispose()`, with the same message as every other method.
   * Call it at the start of a method that does work before it sends a request.
   */
  assertAlive(): void
  /** The current time from the clock adapter, in milliseconds. Used to compute expiry times. */
  now(): number
  /** Creates a new PKCE pair for each sign-in. */
  newPkce(): Promise<Pkce>
  /** The stored `deviceKey`. It is created and stored when missing. */
  deviceKey(): string
  /** Hashes a password to the SHA-256 hex the specification requires. The plain text never goes to the server. */
  hashPassword(raw: string): Promise<string>
}

interface PrivilegedModuleContext extends ModuleContext {
  readonly privileged: PrivilegedContext
}

declare const apiType: unique symbol

/** The value a registration function such as `mailbox()` returns. The app can see only its name, version, and server. */
export interface ModuleFactory<Id extends string, Api extends object> {
  readonly id: Id
  readonly sdkVersion: string
  readonly baseUrl: string
  /** Carries the API type only. It has no run-time value. */
  readonly [apiType]?: Api
}

type Internals =
  | { readonly privileged: false; bind(ctx: ModuleContext): object }
  | { readonly privileged: true; bind(ctx: PrivilegedModuleContext): object }

/**
 * An internal mark that shows the SDK created the module. The map itself is not exported from this file.
 * So an object that imitates a module without a registration function is rejected at registration.
 * However, `definePrivilegedModule` is shared by auth and token, so the release bundle exports it from a shared chunk.
 * Code that imports that chunk by path can create a privileged module.
 * Such a module gets access only if the app puts it in `modules`. The SDK does not guard against code the app itself adds.
 * If ESM and CJS builds both load on one page, this map exists twice.
 * A module created by the other copy then has no mark and is rejected at registration.
 */
const INTERNALS = new WeakMap<object, Internals>()

/** Creates a module factory and marks it with `internals`. */
function register<Id extends string, Api extends object>(
  id: Id,
  defaultHost: string,
  options: ModuleOptions,
  internals: Internals,
): ModuleFactory<Id, Api> {
  // The server of a module: the app's `baseUrl`, or the module's default server.
  const baseUrl = options.baseUrl ?? defaultHost
  const factory = Object.freeze({ id, sdkVersion: SDK_VERSION, baseUrl })
  INTERNALS.set(factory, internals)
  return factory
}

/**
 * Defines a feature module. `defaultHost` is its server from the specification.
 * `options` are the options the app passed to the registration function. Its `baseUrl` replaces the default server.
 */
export function defineModule<Id extends KnownModuleId, Api extends object>(
  id: Id,
  defaultHost: string,
  options: ModuleOptions,
  bind: (ctx: ModuleContext) => Api,
): ModuleFactory<Id, Api> {
  return register(id, defaultHost, options, { privileged: false, bind })
}

/** Defines a module that receives session write access (auth and token). Each instance passes the access through `bind`. */
export function definePrivilegedModule<Id extends PrivilegedModuleId, Api extends object>(
  id: Id,
  defaultHost: string,
  options: ModuleOptions,
  bind: (ctx: PrivilegedModuleContext) => Api,
): ModuleFactory<Id, Api> {
  return register(id, defaultHost, options, { privileged: true, bind })
}

export function internalsOf(value: unknown): Internals | undefined {
  return typeof value === 'object' && value !== null ? INTERNALS.get(value) : undefined
}
