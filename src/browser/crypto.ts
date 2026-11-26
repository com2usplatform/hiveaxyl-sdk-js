import type { CryptoAdapter } from '../core/adapters'
import { hex } from '../core/encoding'

export function createWebCrypto(): CryptoAdapter {
  const c = globalThis.crypto
  const randomBytes = (length: number) => c.getRandomValues(new Uint8Array(length))
  return {
    randomBytes,
    uuid: () => (typeof c.randomUUID === 'function' ? c.randomUUID() : uuidV4(randomBytes(16))),
    sha256: async (data) => new Uint8Array(await c.subtle.digest('SHA-256', new Uint8Array(data))),
  }
}

/** A fallback for supported browsers without `crypto.randomUUID`: Firefox 92 to 94. */
function uuidV4(b: Uint8Array): string {
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
