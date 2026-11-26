import type { ClockAdapter } from '../core/adapters'

export function createBrowserClock(): ClockAdapter {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}
