// Byte encodings that Core uses. Core does not use browser globals such as `atob` or `btoa`.

/** Converts bytes to a lowercase hex string. */
export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** The base64url alphabet (RFC 4648 section 5). */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding (RFC 4648 section 5). */
export function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64URL_ALPHABET[(n >> 18) & 63]! + BASE64URL_ALPHABET[(n >> 12) & 63]!
    if (i + 1 < bytes.length) out += BASE64URL_ALPHABET[(n >> 6) & 63]!
    if (i + 2 < bytes.length) out += BASE64URL_ALPHABET[n & 63]!
  }
  return out
}

/**
 * Decodes base64url into a string of byte values. It also accepts the `+` and `/` of plain base64.
 * Byte values are enough to read ASCII JSON, such as a JWT payload.
 * Throws when the text has a character outside the alphabet.
 */
export function decodeBase64Url(text: string): string {
  let bits = 0
  let value = 0
  let out = ''
  // Trim trailing `=` with a loop. A regular expression here takes quadratic time on long runs of `=`.
  let end = text.length
  while (end > 0 && text[end - 1] === '=') end--
  for (const ch of text.slice(0, end)) {
    const v = BASE64URL_ALPHABET.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch)
    if (v < 0) throw new Error('Not base64url.')
    value = ((value << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((value >> bits) & 0xff)
    }
  }
  return out
}
