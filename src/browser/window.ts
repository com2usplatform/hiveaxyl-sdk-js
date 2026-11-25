// The parts that the sign-in window and the payment window share.

/** How often the SDK checks whether a window closed, as in the Unity web runtime. */
const CLOSED_POLL_MS = 500

type Settle<R> = (result: R) => void

/**
 * Calls `window.open` and returns `null` when the browser does not give a window.
 * Most browsers return `null` for a blocked popup. Some throw instead, such as Firefox in an iframe
 * whose `sandbox` lacks `allow-popups`. Both count as a blocked window, so no error reaches the app.
 */
export function openWindow(url: string, target: string, features?: string): WindowProxy | null {
  try {
    if (typeof globalThis.open !== 'function') return null
    const w =
      features === undefined ? globalThis.open(url, target) : globalThis.open(url, target, features)
    return w ?? null
  } catch {
    return null
  }
}

/**
 * Runs one window flow until it ends exactly once.
 * It closes the window if still open, stops the timers and listeners, and resolves the waiting call.
 */
export function windowFlow<R>(w: { closed: boolean; close(): void }, onEnd: () => void) {
  let result: R | undefined
  let resolve: Settle<R> | undefined
  let started = false
  const cleanups: (() => void)[] = []
  /** Reads `result` again. A settle from a listener can change it in the middle of a function. */
  const current = (): R | undefined => result
  const settle: Settle<R> = (r) => {
    if (result !== undefined) return
    result = r
    for (const stop of cleanups.splice(0)) stop()
    try {
      if (!w.closed) w.close()
    } catch {
      // A window that cannot be closed is left to the player.
    }
    onEnd()
    resolve?.(r)
  }
  /** Ends the flow with `r` when `signal` aborts. */
  const abortWith = (signal: AbortSignal | undefined, r: () => R): void => {
    if (!signal) return
    if (signal.aborted) return settle(r())
    const onAbort = () => settle(r())
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', onAbort))
  }
  return {
    settle,
    get result() {
      return current()
    },
    /** Runs `stop` when the flow ends. */
    onSettle(stop: () => void) {
      if (result === undefined) cleanups.push(stop)
      else stop()
    },
    abortWith,
    /**
     * Starts the one step that uses the window, such as `signIn` or `show`. A second start gets `inProgress()`.
     * From then on, `signal` also ends the flow with `cancelled()`.
     * Returns the result to give back at once: `inProgress()`, or the flow result when the flow already ended,
     * for example because `signal` had already aborted. Returns `undefined` when the step can go on.
     */
    start(signal: AbortSignal | undefined, inProgress: () => R, cancelled: () => R): R | undefined {
      if (started) return inProgress()
      started = true
      if (result !== undefined) return result
      abortWith(signal, cancelled)
      // `abortWith` settles at once when `signal` has already aborted.
      return current()
    },
    /** Waits for the end of the flow. */
    wait(): Promise<R> {
      return result !== undefined ? Promise.resolve(result) : new Promise((r) => (resolve = r))
    },
  }
}

/** Starts polling `closed`. When the window closes, `onClosed` runs once after `graceMs`. */
export function watchClosed(w: { closed: boolean }, graceMs: number, onClosed: () => void) {
  let grace: ReturnType<typeof setTimeout> | undefined
  const poll = setInterval(() => {
    if (!w.closed) return
    clearInterval(poll)
    if (graceMs === 0) onClosed()
    else grace = setTimeout(onClosed, graceMs)
  }, CLOSED_POLL_MS)
  return () => {
    clearInterval(poll)
    if (grace !== undefined) clearTimeout(grace)
  }
}
