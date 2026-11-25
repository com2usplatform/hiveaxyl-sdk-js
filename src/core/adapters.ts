import type { WebAuthAdapter } from './webauth'

/**
 * The points where Core depends on its environment.
 * Core knows only these interfaces. It does not import the browser implementations.
 * The default browser implementations are in `src/browser/`, and `src/index.ts` assembles them.
 * Tests and other hosts replace them through the `adapters` option of `createAxyl`.
 */

/** An HTTP request that Core passes to the transport adapter. */
export interface HttpRequest {
  /** The full request URL. */
  readonly url: string
  /** The HTTP method. */
  readonly method: string
  /** The request headers. */
  readonly headers: Readonly<Record<string, string>>
  /** The JSON request body. It is absent for requests without a body. */
  readonly body?: string
  /**
   * Aborts the request on timeout or cancellation.
   * A custom transport must stop and reject when it aborts, including while it reads the body.
   * A transport that ignores it can make a call wait forever.
   */
  readonly signal: AbortSignal
  /**
   * Do not follow redirects. This keeps credentials from reaching another server.
   * The adapter must pass this value through unchanged.
   */
  readonly redirect: 'error'
  /**
   * `true` when the request should outlive the page, as with the `keepalive` option of `fetch`.
   * A custom transport should pass this value through unchanged.
   * Browsers limit the bodies of `keepalive` requests in progress to 64 KiB in total for each page.
   * Each SDK client keeps its own requests under that limit.
   * Other clients, `navigator.sendBeacon`, and the app's own `keepalive` requests share the same limit.
   * When the browser rejects a request over the limit, the attempt fails as a connection error and the usual retry rules apply.
   * A transport that ignores it still sends the request, but closing the tab can then cancel it.
   */
  readonly keepalive?: boolean
}

/** An HTTP response that the transport adapter returns. */
export interface HttpResponse {
  /** The HTTP status code. */
  readonly status: number
  /** Returns a response header value, or `null` when it is missing or not readable. */
  header(name: string): string | null
  /** Reads the response body as text. */
  text(): Promise<string>
}

/**
 * Sends HTTP requests.
 * A replacement transport receives requests unchanged.
 * It sees the `Authorization` header and the refresh token in the token refresh body.
 * Replace it only with code you trust.
 * This is the only path where the refresh token is visible outside the SDK.
 */
export interface TransportAdapter {
  /** Sends a request. Throw on connection failure or cancellation. Core catches it and returns a result. */
  send(req: HttpRequest): Promise<HttpResponse>
}

/**
 * Stores small values that are not secret, such as the device key.
 * The SDK never stores tokens here.
 */
export interface StorageAdapter {
  /** Returns the stored value, or `null` when there is none. */
  get(key: string): string | null
  /** Stores a value. */
  set(key: string, value: string): void
  /** Removes a value. */
  remove(key: string): void
  /** `true` when values survive a page reload. `false` when browser storage is blocked and memory is used instead. */
  readonly persistent: boolean
}

/** Reports facts about the runtime environment. */
export interface EnvironmentAdapter {
  /** `true` when the page runs in a secure context (HTTPS or localhost). */
  isSecureContext(): boolean
  /** `true` when Web Crypto (`crypto.subtle`) is available. */
  hasWebCrypto(): boolean
  /** `false` when the device is known to be offline. */
  isOnline(): boolean
  /** The user's preferred language as a BCP 47 tag, if known. */
  language(): string | undefined
  /**
   * The operating system name and version, such as `Windows 10`. The SDK sends it as `X-OS-Version`.
   * The default reads the User-Agent, as a Unity WebGL build does. Browsers freeze parts of the User-Agent,
   * so the version can be older than the real one, such as `Windows 10` on Windows 11. Treat it as the operating system family.
   * The SDK reads it once, when it creates the client. Without a value, the header is not sent.
   * Use visible ASCII characters only. The SDK leaves out any other value and logs a `warn`.
   */
  osVersion?(): string | undefined
}

/** Provides random values and hashing. */
export interface CryptoAdapter {
  /** Returns a random UUID. */
  uuid(): string
  /** Returns cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array
  /** Returns the SHA-256 digest of `data`. */
  sha256(data: Uint8Array): Promise<Uint8Array>
}

/** Provides the current time and timers. */
export interface ClockAdapter {
  /** The current time in milliseconds since the Unix epoch. */
  now(): number
  /** Starts a timer and returns its handle. */
  setTimeout(fn: () => void, ms: number): unknown
  /** Stops a timer started by `setTimeout`. */
  clearTimeout(handle: unknown): void
}

/** The adapters that every SDK instance needs. */
export interface Adapters {
  readonly transport: TransportAdapter
  readonly storage: StorageAdapter
  readonly environment: EnvironmentAdapter
  readonly crypto: CryptoAdapter
  readonly clock: ClockAdapter
}

/** Functions that create the default adapters. The SDK creates only the adapters the app did not pass. */
export type AdapterFactories = { readonly [K in keyof Adapters]: () => Adapters[K] }

/** A window that was opened in advance, inside a click handler. */
export interface PopupWindow {
  /**
   * Moves the window to `url`. It clears `opener` before it moves, which suits a payment window.
   * A sign-in popup needs `opener` to send its result back, so it does not use this method.
   * It opens only `https:` URLs. Returns `true` when it moved.
   */
  navigate(url: string): boolean
  /** Closes the window. */
  close(): void
  /**
   * Returns `true` when the window seems closed. Treat it only as a hint.
   * It can be `true` while the window is still open, when the page sends a `Cross-Origin-Opener-Policy` header.
   */
  looksClosed(): boolean
}

/** Opens popup windows, such as the payment window. Only modules that use popups load it. */
export interface PopupAdapter {
  /**
   * Opens a blank window. Returns `null` when the browser blocks it.
   * A window that already looks closed is treated as blocked too, and the SDK closes it.
   * Call it directly inside a user click handler so the browser does not block it.
   */
  openBlank(): PopupWindow | null
}

/** A change in tab state. New values may be added. Ignore values you do not know. */
export type LifecycleEvent = 'hidden' | 'visible' | 'pagehide'

/**
 * Reports when the tab is hidden, shown again, or closed.
 * No module uses it in this release.
 * The SDK accepts a `lifecycle` adapter in `createAxyl({ adapters })` but does not call it.
 * Logs do not depend on it. The SDK sends `analytics` requests with `keepalive`, so closing the tab does not cancel them.
 * Browsers limit the size of such requests, so see `collectClientLog` for when this does not hold.
 * Tab events do not refresh tokens.
 *
 * A replacement must follow three rules.
 * It calls the listener only with `LifecycleEvent` values.
 * The function that `subscribe` returns removes every listener that `subscribe` added.
 * It does not listen to the `unload` event, because the browser then stops keeping the page in its back/forward cache.
 */
export interface LifecycleAdapter {
  /** Starts listening. Call the returned function to stop. */
  subscribe(listener: (event: LifecycleEvent) => void): () => void
}

/**
 * Optional adapters that only some features need.
 * Core does not create defaults for them. The module that uses the feature loads its own default.
 * If you do not register that module, the default stays out of your bundle.
 * Replace them through the `adapters` option of `createAxyl`.
 */
export interface FeatureAdapters {
  readonly popup: PopupAdapter
  readonly lifecycle: LifecycleAdapter
  readonly webAuth: WebAuthAdapter
}
