/**
 * The default server for each module. The values match the Unity SDK.
 * A module's `baseUrl` option can change it. The new value must still be in the allowed list below.
 */
export const HOSTS = Object.freeze({
  core: 'https://core-api.hiveaxyl.com',
  app: 'https://app-api.hiveaxyl.com',
  commerce: 'https://commerce-api.hiveaxyl.com',
  commerceSandbox: 'https://sandbox-commerce-api.hiveaxyl.com',
  data: 'https://data-api.hiveaxyl.com',
})

declare const __AXYL_TEST_ORIGIN__: string | undefined
declare const __AXYL_TEST_ORIGINS__: readonly string[] | undefined

/**
 * Extra origins that only development builds allow: one default test server and the test servers per service.
 * Release builds replace both with `undefined`, so they allow only the servers above.
 * The build writes the values into the code. A global variable on the page cannot change them.
 * Development tools read `TEST_ORIGIN` by name from the development build, so the name stays.
 */
const TEST_ORIGIN: string | undefined = __AXYL_TEST_ORIGIN__
const TEST_ORIGINS: readonly string[] | undefined = __AXYL_TEST_ORIGINS__

/**
 * The origins that may receive tokens.
 * It is not exported. An exported set could be extended with `add`.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  ...Object.values(HOSTS),
  ...(TEST_ORIGIN === undefined ? [] : [TEST_ORIGIN, ...(TEST_ORIGINS ?? [])]),
])

/** Returns `true` when `origin` may receive tokens. It compares exact strings only. */
export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin)
}

/** Removes one trailing `/`, so `https://core-api.hiveaxyl.com/` and `https://core-api.hiveaxyl.com` mean the same server. */
export const withoutTrailingSlash = (baseUrl: string): string => baseUrl.replace(/\/$/, '')

/**
 * Returns `true` when `baseUrl` is an allowed server.
 * It removes one trailing `/` and compares the rest with the allowed list as an exact string.
 * So a URL with a path, a query, or user info is always rejected.
 */
export function isAllowedBaseUrl(baseUrl: unknown): boolean {
  return typeof baseUrl === 'string' && isAllowedOrigin(withoutTrailingSlash(baseUrl))
}
