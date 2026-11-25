import type { LifecycleAdapter } from '../core/adapters'

/** The browser default of `LifecycleAdapter`. It listens to `visibilitychange` and `pagehide`. */
export function createBrowserLifecycle(): LifecycleAdapter {
  return {
    subscribe(listener) {
      const onVisibility = () =>
        listener(globalThis.document.visibilityState === 'hidden' ? 'hidden' : 'visible')
      const onPageHide = () => listener('pagehide')
      globalThis.document.addEventListener('visibilitychange', onVisibility)
      globalThis.addEventListener('pagehide', onPageHide)
      return () => {
        globalThis.document.removeEventListener('visibilitychange', onVisibility)
        globalThis.removeEventListener('pagehide', onPageHide)
      }
    },
  }
}
