import type { StorageAdapter } from '../core/adapters'

/** The prefix of every key the SDK writes to browser storage. */
export const STORAGE_KEY_PREFIX = 'hiveaxyl:'

/**
 * Stores only values that are not secret, such as `deviceKey`. Tokens and `guestToken` never go here.
 * Browser code and storage can be read by any script on the page.
 * When access throws, as when the browser blocks site data or in a sandboxed iframe, memory is used instead.
 */
export function createWebStorage(): StorageAdapter {
  const web = tryOpen()
  if (!web) return createMemoryStorage()
  // If access is blocked or storage is full after the first check, switch to memory and use only memory from then on.
  // This keeps `deviceKey` from being recreated on every call. It stays the same for this page session.
  let memory: StorageAdapter | null = null
  const fallback = () => (memory ??= createMemoryStorage())
  return {
    get persistent() {
      return memory === null
    },
    get: (key) => {
      if (memory) return memory.get(key)
      try {
        return web.getItem(STORAGE_KEY_PREFIX + key)
      } catch {
        return fallback().get(key)
      }
    },
    set: (key, value) => {
      if (memory) return memory.set(key, value)
      try {
        web.setItem(STORAGE_KEY_PREFIX + key, value)
      } catch {
        fallback().set(key, value)
      }
    },
    remove: (key) => {
      if (memory) return memory.remove(key)
      try {
        web.removeItem(STORAGE_KEY_PREFIX + key)
      } catch {
        // A failed removal does not affect later operations.
      }
    },
  }
}

export function createMemoryStorage(): StorageAdapter {
  const map = new Map<string, string>()
  return {
    persistent: false,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  }
}

function tryOpen(): Storage | null {
  try {
    const s = globalThis.localStorage
    const probe = `${STORAGE_KEY_PREFIX}probe`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}
