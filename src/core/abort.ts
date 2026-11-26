// Helpers for the two ways a call stops: the app's `signal` and `dispose()`.

/**
 * `true` once `dispose()` (`lifetime`) or the app's `signal` stopped a call.
 * It reads both signals on every call, so it also works before they are linked.
 */
export const isStopped = (lifetime: AbortSignal, signal: AbortSignal | undefined): boolean =>
  lifetime.aborted || signal?.aborted === true

/** Aborts `ctrl` when any of `signals` aborts. Returns a function that removes the listeners. */
export function linkSignals(
  ctrl: AbortController,
  signals: (AbortSignal | undefined)[],
): () => void {
  const abort = () => ctrl.abort()
  const linked: AbortSignal[] = []
  for (const s of signals) {
    if (!s) continue
    if (s.aborted) {
      ctrl.abort()
      continue
    }
    s.addEventListener('abort', abort, { once: true })
    linked.push(s)
  }
  return () => linked.forEach((s) => s.removeEventListener('abort', abort))
}

/**
 * Waits for `wait` to settle, or resolves with `onAbort` as soon as `signal` aborts.
 * `wait` receives the function that settles the wait and returns a function that stops it, such as clearing a timer.
 * An abort runs that stop function. A wait that settles first removes the abort listener.
 */
export function abortable<T>(
  signal: AbortSignal,
  onAbort: T,
  wait: (settle: (value: T) => void) => () => void,
): Promise<T> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(onAbort)
      return
    }
    let stop: (() => void) | undefined
    const abort = () => {
      stop?.()
      resolve(onAbort)
    }
    signal.addEventListener('abort', abort, { once: true })
    stop = wait((value) => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    })
  })
}
