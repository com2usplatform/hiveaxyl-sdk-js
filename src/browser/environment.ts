import type { EnvironmentAdapter } from '../core/adapters'
import type { OpenEnum } from '../core/operation'

/**
 * Returns `false` where `window` does not exist, such as during server rendering.
 * Do not call it at import time. Importing the SDK must not touch browser APIs.
 */
export const hasBrowserGlobals = (): boolean =>
  typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined'

/** The User-Agent of this browser, or an empty string where there is none. */
export const userAgent = (): string => globalThis.navigator?.userAgent ?? ''

/** Provides header values and facts about the runtime environment. */
export function createBrowserEnvironment(): EnvironmentAdapter {
  return {
    isSecureContext: () => Boolean(globalThis.isSecureContext),
    hasWebCrypto: () => typeof globalThis.crypto?.subtle?.digest === 'function',
    isOnline: () => globalThis.navigator?.onLine ?? true,
    language: () => globalThis.navigator?.language,
    osVersion: () => osVersionOf(userAgent()),
  }
}

/**
 * Operating system patterns, checked in order. The first group is the version.
 * A pattern matches only when its group is not empty.
 * The list and its results match the Unity SDK's WebGL build, so the server sees the same values from both SDKs.
 * That includes its gaps: a desktop Linux User-Agent and a search bot both give `Unknown OS Unknown OS Version`.
 */
const OS_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['Windows', /Windows (.*?)[;)]/i],
  ['Android', /Android ([0-9_.]+)/i],
  ['iPhoneOS', /iPhone OS ([0-9_.]+)/i],
  ['iPadOS', /iPad.*? OS ([0-9_.]+)/i],
  ['FreeBSD', /FreeBSD( )/i],
  ['OpenBSD', /OpenBSD( )/i],
  ['Linux', /linux|x11()/i],
  ['MacOS', /Mac OS X ([0-9_.]+)/i],
  ['Search Bot', /bot|google|baidu|bing|msn|teoma|slurp|yandex/i],
]

/** Windows NT versions and the names the Unity SDK's WebGL build reports for them. */
const WINDOWS_NAMES: ReadonlyMap<string, string> = new Map([
  ['NT 5.0', '2000'],
  ['NT 5.1', 'XP'],
  ['NT 5.2', 'Server 2003'],
  ['NT 6.0', 'Vista'],
  ['NT 6.1', '7'],
  ['NT 6.2', '8'],
  ['NT 6.3', '8.1'],
  ['NT 10.0', '10'],
])

/**
 * Returns the `X-OS-Version` value for a User-Agent, such as `Windows 10`, `MacOS 10.15.7` or `Android 10`.
 * Browsers freeze parts of the User-Agent, so the version can be older than the real one.
 * For example, Windows 11 reports `Windows 10`.
 */
export function osVersionOf(userAgent: string): string {
  const ua = `${userAgent} `
  let os: string | undefined
  let version: string | undefined
  for (const [name, pattern] of OS_PATTERNS) {
    const found = pattern.exec(ua)?.[1]
    if (found) {
      os = name
      version = found.replace(/_/g, '.')
      break
    }
  }
  version = (version !== undefined && WINDOWS_NAMES.get(version)) || version
  return `${os ?? 'Unknown OS'} ${version || 'Unknown OS Version'}`
}

/**
 * An in-app browser that the SDK recognizes.
 * - `kakaotalk`, `line`, `instagram`, `facebook`, `naver`: the browser inside that app.
 * - `androidWebView`: another Android app that shows the page in a WebView.
 */
export type InAppBrowser =
  'kakaotalk' | 'line' | 'instagram' | 'facebook' | 'naver' | 'androidWebView'

/** User-Agent patterns, checked in order. The named apps come before the generic Android WebView mark. */
const IN_APP_PATTERNS: readonly (readonly [InAppBrowser, RegExp])[] = [
  ['kakaotalk', /KAKAOTALK/i],
  ['line', /\sLine\/\d/],
  ['instagram', /\bInstagram\s\d/],
  ['facebook', /FBAN\/|FBAV\/|FB_IAB\//],
  ['naver', /NAVER\(inapp/i],
  ['androidWebView', /Android.*;\s?wv\)/],
]

/** Returns the in-app browser that `userAgent` belongs to, or `null` for a regular browser. */
export function inAppBrowserOf(userAgent: string): InAppBrowser | null {
  for (const [name, pattern] of IN_APP_PATTERNS) if (pattern.test(userAgent)) return name
  return null
}

/** Facts about where the page runs. The SDK reports them. Your app decides what to tell the player. */
export interface BrowserEnvironment {
  /**
   * The in-app browser the page runs in, or `null` for a regular browser.
   * In-app browsers often block popups, and some providers refuse sign-in there.
   * Ask the player to open the game in their regular browser.
   * New values may be added. Handle unknown values in a default branch.
   */
  readonly inAppBrowser: OpenEnum<InAppBrowser> | null
  /**
   * `true` when the page runs inside an iframe, such as on a game portal.
   * A popup opens only when the iframe allows it. See the README section "Page security".
   */
  readonly inIframe: boolean
}

/**
 * Detects an in-app browser and an iframe from the User-Agent and the window.
 * It sends no request and works before `createAxyl`.
 * Outside a browser, such as during server rendering, it reports a regular top-level page.
 * The User-Agent check is a best effort. An app can change its User-Agent.
 *
 * @example
 * const env = detectEnvironment()
 * if (env.inAppBrowser !== null) showOpenInBrowserHint()
 */
export function detectEnvironment(): BrowserEnvironment {
  if (!hasBrowserGlobals()) return Object.freeze({ inAppBrowser: null, inIframe: false })
  return Object.freeze({
    inAppBrowser: inAppBrowserOf(userAgent()),
    inIframe: isInIframe(),
  })
}

function isInIframe(): boolean {
  try {
    return globalThis.self !== globalThis.top
  } catch {
    // Some sandboxed frames throw when `top` is read. Only a frame does that.
    return true
  }
}
