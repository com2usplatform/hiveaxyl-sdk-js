import { jsonParse, jsonStringify } from './json'

/**
 * Sends and receives int64 IDs without losing precision.
 * A JS `number` cannot hold every integer above 2^53 exactly. So public types use `string` for IDs.
 * The SDK does not guess ID fields by name. Each operation lists their paths in `ids`.
 * A path uses `.` for a field and `[]` for an array element. Examples: `items[].recipientPlayerId`, `[].id`.
 * A path cannot tell apart a key that contains `.`. No specification has such a key.
 */

/** The ID paths of an operation. Request paths start at the body. Response paths start at `data`. */
export interface IdPaths {
  readonly request?: readonly string[]
  readonly response?: readonly string[]
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
/** An integer as JSON writes it. JSON does not allow leading zeros. */
const INTEGER = /^-?(?:0|[1-9]\d*)$/
/**
 * The most zeros that an exponent may add to the digits.
 * Without a cap, a value such as `1e999999999` would build a string of a billion digits.
 * An int64 has at most 19 digits, so this cap leaves ample room. A value over the cap stays a JSON number.
 */
const MAX_SHIFT = 400

/**
 * The exact decimal digits of a JSON number, or `undefined` when it is not an integer.
 * It works on the text, so a value beyond `Number.MAX_SAFE_INTEGER` keeps every digit.
 */
function integerDigits(token: string): string | undefined {
  if (INTEGER.test(token)) return token === '-0' ? '0' : token
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)
  if (!m) return undefined
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = m
  const shift = Number(exponent) - fraction.length
  let digits = whole + fraction
  if (shift >= 0) {
    if (shift > MAX_SHIFT) return undefined
    digits += '0'.repeat(shift)
  } else {
    const dropped = digits.slice(shift)
    if (/[^0]/.test(dropped)) return undefined
    digits = digits.slice(0, shift)
  }
  digits = digits.replace(/^0+(?=\d)/, '')
  // `0e-1` drops every digit. It is still the integer 0.
  return digits === '0' || digits === '' ? '0' : sign + digits
}

/** The number of steps in a path. The parser builds and compares a path only at these stack depths. */
const depthOf = (path: string) => path.split(/(\[\])|\./).filter(Boolean).length

/** Converts response paths to paths from the body root. A path into an array `data` starts with `[]`. */
export const responsePaths = (paths: readonly string[] = []): ReadonlySet<string> =>
  new Set(paths.map((p) => (p.startsWith('[]') ? `data${p}` : `data.${p}`)))

/**
 * Parses a JSON body after it turns the integers at `paths` into strings with their original digits.
 * It skips string contents, so `{`, `"`, and digits inside a value stay unchanged.
 * If the body is not JSON, it changes nothing and lets `JSON.parse` throw.
 */
export function parseWithIds(text: string, paths: ReadonlySet<string>): unknown {
  return jsonParse(paths.size === 0 ? text : quoteIdNumbers(text, paths))
}

function quoteIdNumbers(text: string, paths: ReadonlySet<string>): string {
  // Avoids building a path for every number in a deeply nested body.
  const depths = new Set([...paths].map(depthOf))
  const stack: { readonly array: boolean; key: string | null }[] = []
  const path = () => {
    let p = ''
    for (const f of stack) p += f.array ? '[]' : p === '' ? (f.key ?? '') : `.${f.key ?? ''}`
    return p
  }
  let out = ''
  let copied = 0
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const top = stack.at(-1)
      // Inside an object that is waiting for a key, this string is the key. A value string does not change the key.
      if (top && !top.array && top.key === null) top.key = jsonParse(text.slice(i, j + 1)) as string
      i = j + 1
    } else if (c === '{' || c === '[') {
      stack.push({ array: c === '[', key: null })
      i++
    } else if (c === '}' || c === ']') {
      stack.pop()
      i++
    } else if (c === ',') {
      const top = stack.at(-1)
      if (top && !top.array) top.key = null
      i++
    } else if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(text)
      if (!m) return text
      const end = i + m[0].length
      // Only integers change. Public types promise integer strings.
      // An integer keeps every digit, even when the server writes it another way (`1e3`).
      if (depths.has(stack.length) && paths.has(path())) {
        const digits = integerDigits(m[0])
        if (digits !== undefined) {
          out += `${text.slice(copied, i)}"${digits}"`
          copied = end
        }
      }
      i = end
    } else {
      i++
    }
  }
  return out + text.slice(copied)
}

/**
 * Serializes a request body to JSON. Integer strings at `paths` are written as numbers without quotes.
 * The server expects IDs as numbers. The value never passes through `Number()`, so IDs above 2^53 stay exact.
 * A string that is not an integer is sent as a string, and the server validates it.
 * Every other value goes through `JSON.stringify`, so user input strings stay unchanged whatever characters they contain.
 * Throws when the whole value has no JSON form, such as a function or a symbol.
 */
export function stringifyWithIds(value: unknown, paths: readonly string[] = []): string {
  const json = paths.length === 0 ? jsonStringify(value) : write(value, '', new Set(paths))
  // `JSON.stringify` returns `undefined` for such a value instead of throwing.
  if (json === undefined) throw new TypeError('The value has no JSON form.')
  return json
}

function write(value: unknown, path: string, targets: ReadonlySet<string>): string | undefined {
  if (typeof value === 'string' && targets.has(path) && INTEGER.test(value)) return value
  if (Array.isArray(value)) {
    return `[${Array.from(value, (v) => write(v, `${path}[]`, targets) ?? 'null').join(',')}]`
  }
  if (typeof value === 'object' && value !== null && !('toJSON' in value)) {
    const fields: string[] = []
    for (const [k, v] of Object.entries(value)) {
      const json = write(v, path === '' ? k : `${path}.${k}`, targets)
      if (json !== undefined) fields.push(`${jsonStringify(k)}:${json}`)
    }
    return `{${fields.join(',')}}`
  }
  // Returns `undefined` for `undefined` and functions, so the field is left out as `JSON.stringify` does.
  return jsonStringify(value)
}
