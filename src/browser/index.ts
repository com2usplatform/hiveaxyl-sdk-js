import type { AdapterFactories } from '../core/adapters'
import { createBrowserClock } from './clock'
import { createWebCrypto } from './crypto'
import { createBrowserEnvironment } from './environment'
import { createWebStorage } from './storage'
import { createFetchTransport } from './transport'

/**
 * Functions that create the default browser adapters. `createAxyl` creates only the adapters the app did not pass.
 * Nothing here touches browser APIs at import time.
 * The popup and web auth adapters are loaded by the modules that use them.
 * If those modules are not registered, the adapters stay out of the bundle.
 */
export const browserAdapters: AdapterFactories = Object.freeze({
  transport: createFetchTransport,
  storage: createWebStorage,
  environment: createBrowserEnvironment,
  crypto: createWebCrypto,
  clock: createBrowserClock,
})

export { hasBrowserGlobals } from './environment'
