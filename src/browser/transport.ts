import type { HttpResponse, TransportAdapter } from '../core/adapters'

/**
 * A transport adapter based on `fetch`. `createAxyl` creates it and captures `fetch` at that moment.
 * It also captures the functions that read a response: `Response#text`, `Response#status`, `Response#headers` and `Headers#get`.
 * SDK requests and responses can hold tokens.
 * If another script replaces these functions later, SDK requests and responses do not pass through the replacement.
 * A response that is not a real `Response`, such as a test double, is read through its own properties.
 * Other built-in functions are not covered.
 * Scripts that run before `createAxyl` are not covered either.
 * Treat every script on the page as trusted.
 */
export function createFetchTransport(): TransportAdapter {
  const fetchFn = globalThis.fetch.bind(globalThis)
  const apply = Reflect.apply
  const readText = capture(Response.prototype, 'text', 'value')
  const readStatus = capture(Response.prototype, 'status', 'get')
  const readHeaders = capture(Response.prototype, 'headers', 'get')
  const getHeader = capture(Headers.prototype, 'get', 'value')
  return {
    async send(r) {
      const res = await fetchFn(r.url, {
        method: r.method,
        headers: r.headers,
        ...(r.body !== undefined && { body: r.body }),
        signal: r.signal,
        redirect: r.redirect,
        ...(r.keepalive === true && { keepalive: true }),
        credentials: 'omit',
        cache: 'no-store',
      })
      let status: number
      try {
        // The captured getter checks that `res` is a real `Response`. It throws for anything else.
        status = apply(readStatus, res, []) as number
      } catch {
        return readPlain(res)
      }
      const headers = apply(readHeaders, res, []) as Headers
      return {
        status,
        header: (name) => apply(getHeader, headers, [name]) as string | null,
        text: () => apply(readText, res, []) as Promise<string>,
      }
    },
  }
}

/**
 * Reads a response that is not a real `Response` through its own properties.
 * App tests often replace `fetch` with a function that returns a plain object, such as `{ status, headers, text }`.
 * The captured functions reject such an object, so this path keeps those tests working.
 */
function readPlain(res: unknown): HttpResponse {
  const r = res as { status?: unknown; headers?: unknown; text?: unknown }
  const status = r.status
  // A status that is not an HTTP status code would break classification, so it fails like a network error.
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError('The response has no valid HTTP status.')
  }
  const headers = r.headers as { get?: unknown } | null | undefined
  return {
    status,
    header: (name) => {
      const get = headers?.get
      return typeof get === 'function'
        ? ((Reflect.apply(get, headers, [name]) as string | null | undefined) ?? null)
        : null
    },
    text: () => Reflect.apply(r.text as Captured, res, []) as Promise<string>,
  }
}

type Captured = (this: unknown, ...args: unknown[]) => unknown

/** Takes a method (`value`) or getter (`get`) from the prototype as it is now. */
function capture(proto: object, name: string, kind: 'get' | 'value'): Captured {
  const desc: { get?: unknown; value?: unknown } =
    Object.getOwnPropertyDescriptor(proto, name) ?? {}
  const fn = desc[kind]
  if (typeof fn === 'function') return fn as Captured
  // Every browser with `fetch` has these. If one is missing, read the property at call time instead.
  return kind === 'get'
    ? function (this: unknown) {
        return Reflect.get(this as object, name)
      }
    : function (this: unknown, ...args: unknown[]) {
        return Reflect.apply(Reflect.get(this as object, name) as Captured, this, args)
      }
}
