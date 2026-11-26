/**
 * The SDK keeps its own references to `JSON.parse` and `JSON.stringify`, taken when this module loads.
 * Request and response bodies can hold tokens. A script that loads after the SDK and wraps these
 * functions on the global `JSON` object does not see those bodies.
 * Other built-in functions are not covered, and scripts that run before the SDK loads are not covered.
 * Treat every script on the page as trusted.
 */
export const jsonParse: (text: string) => unknown = JSON.parse
export const jsonStringify: (value: unknown) => string | undefined = JSON.stringify

/** `true` for an object that is not `null` and not an array, such as a parsed JSON object. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
