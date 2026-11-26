import type { CryptoAdapter, StorageAdapter } from './adapters'
import { base64url, hex } from './encoding'

// Credential handling for sign-in.
// It lives in the SDK, not in the recipes. Apps copy recipes, so a fix in a recipe would not reach existing apps.

/** One PKCE pair for a single sign-in (RFC 7636). Create a new pair for every sign-in. */
export interface Pkce {
  /** The value sent to the sign-in API. It is the base64url SHA-256 of `verifier`, 43 characters long. */
  readonly challenge: string
  readonly challengeMethod: 'S256'
  /** The original value sent to `issueToken`. Discard it after sign-in. Sensitive. Do not log or persist. */
  readonly verifier: string
}

/** Creates `verifier` (43 characters) from 32 random bytes and derives `challenge` with SHA-256. */
export async function createPkce(crypto: CryptoAdapter): Promise<Pkce> {
  const verifier = base64url(crypto.randomBytes(32))
  const digest = await crypto.sha256(new TextEncoder().encode(verifier))
  return Object.freeze({ challenge: base64url(digest), challengeMethod: 'S256', verifier })
}

const DEVICE_KEY = 'deviceKey'
/** The `deviceKey` format from the specification: 22 to 64 printable ASCII characters. */
const DEVICE_KEY_FORMAT = /^[!-~]{22,64}$/

/**
 * Returns the device key for this browser.
 * It reuses the stored value. It creates a new one when none is stored or the stored one is malformed.
 * The value changes when the browser storage is cleared.
 * When storage is blocked, the value lasts only for this page session.
 */
export function deviceKeyOf(storage: StorageAdapter, crypto: CryptoAdapter): string {
  const saved = storage.get(DEVICE_KEY)
  if (saved !== null && DEVICE_KEY_FORMAT.test(saved)) return saved
  const created = crypto.uuid()
  storage.set(DEVICE_KEY, created)
  return created
}

/**
 * Hashes a password to 64 lowercase SHA-256 hex characters.
 * The auth specification forbids plain-text passwords and requires this format (`^[0-9a-f]{64}$`).
 * The text is hashed as UTF-8 bytes, the same as `PasswordHash.Sha256Hex` in the Unity recipes.
 * In Unity the app hashes the password. In this SDK the SDK hashes it.
 * If the app passes an already hashed value, it is hashed twice and sign-in fails.
 */
export async function sha256Hex(crypto: CryptoAdapter, text: string): Promise<string> {
  return hex(await crypto.sha256(new TextEncoder().encode(text)))
}
