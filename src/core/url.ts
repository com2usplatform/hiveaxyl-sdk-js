import { isAllowedOrigin, withoutTrailingSlash } from './hosts'
import type { AnyOperation } from './operation'
import { failure, type Failure } from './result'

/** Parses an absolute URL. Returns `null` when `text` is not one. */
export function parseUrl(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/** With the `u` flag, a surrogate pair matches as one character. So only lone surrogates match. */
const LONE_SURROGATE = /\p{Surrogate}/u

/**
 * Builds the request URL. URLs are built only in this function.
 * It encodes path arguments and rejects '.', '..', and the empty string to prevent client-side path traversal.
 * A rejection is a `failure`, not an exception, because outside values such as server responses can become path arguments.
 */
export function buildUrl(
  baseUrl: string,
  operation: Pick<AnyOperation, 'path' | 'params'>,
  req: Readonly<Record<string, unknown>> | undefined,
): string | Failure {
  let path = operation.path
  for (const name of operation.params?.path ?? []) {
    const value = req?.[name]
    if (typeof value !== 'string' && typeof value !== 'number') {
      return failure('InvalidArgument', `Path parameter "${name}" is missing.`)
    }
    // IDs are strings in the public types. A number is accepted only when it is exact.
    // `NaN`, `Infinity`, a fraction, or an integer above 2^53 would name another resource, so it is refused.
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      return failure(
        'InvalidArgument',
        `Path parameter "${name}" must be a string or a safe integer. Pass IDs as strings.`,
      )
    }
    const s = String(value)
    // `/` is sent encoded as `%2F`. A server or proxy may still decode it and read it as a path, and then `..` escapes upward.
    // So a value is rejected when it is empty or any piece split by `/` or `\` is '.' or '..'. A value such as 'a/b' is sent as is.
    if (s === '' || s.split(/[/\\]/).some((p) => p === '.' || p === '..')) {
      return failure('InvalidArgument', `Path parameter "${name}" is not allowed.`)
    }
    if (!path.includes(`{${name}}`)) {
      return failure('Internal', `Path parameter "${name}" is not in the path template.`)
    }
    // `encodeURIComponent` throws on a string with a lone surrogate. This case also returns a `failure`.
    if (LONE_SURROGATE.test(s)) {
      return failure('InvalidArgument', `Path parameter "${name}" is not a valid string.`)
    }
    path = path.replace(`{${name}}`, encodeURIComponent(s))
  }
  // Keeps a placeholder missing from `params.path` from going out as is. This happens when a module was copied wrong.
  if (/{[^}]*}/.test(path)) {
    return failure('Internal', 'Path template has a parameter missing from params.path.')
  }

  const url = new URL(withoutTrailingSlash(baseUrl) + path)
  const required = operation.params?.requiredQuery
  for (const name of operation.params?.query ?? []) {
    const value = req?.[name]
    // A required query is sent even when it is an empty string. The server then answers that the value is invalid, not that it is missing.
    // The Unity SDK always sends required queries in the same way.
    if (value === '' && required?.includes(name)) url.searchParams.append(name, '')
    else appendQuery(url.searchParams, name, value)
  }

  if (!isAllowedOrigin(url.origin)) {
    return failure('PermissionDenied', 'Request origin is not allowed.')
  }
  return url.toString()
}

/**
 * Follows the default OpenAPI query serialization (`style: form`, `explode: true`).
 * The current server specifications do not set `style` or `explode`, so they all use this default.
 * Check this again when a specification changes.
 */
function appendQuery(sp: URLSearchParams, name: string, value: unknown): void {
  // An empty string counts as no value and is not sent. The Unity SDK drops an optional query with the same `IsNullOrEmpty` check.
  // `buildUrl` handles a required query before this function is called.
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value)) {
    for (const v of value) appendQuery(sp, name, v)
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) appendQuery(sp, k, v)
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    sp.append(name, String(value))
  }
}
