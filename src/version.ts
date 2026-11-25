declare const __SDK_VERSION__: string

/**
 * The SDK version.
 * The build replaces it with the `package.json` version.
 * The SDK uses it to check that Core and every module come from the same version.
 */
export const SDK_VERSION: string = __SDK_VERSION__
