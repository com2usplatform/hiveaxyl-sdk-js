import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'

/**
 * Keeps only documentation comments (/** ... *\/) in the type declaration files and removes other comments.
 * Documentation comments are the manual that app developers and their AI agents read.
 * License comments (/*! or @license) stay. Lines that hold only a // comment, including #region markers, go.
 * A '//' inside a string, such as a URL, is not at the start of a line, so it stays.
 */
function stripDtsComments(dir: string): void {
  for (const f of readdirSync(dir)) {
    if (!/\.d\.c?ts$/.test(f)) continue
    const p = join(dir, f)
    const out = readFileSync(p, 'utf8')
      .replace(/\/\*(?![!*])[\s\S]*?\*\/[ \t]*\r?\n?/g, (m) => (m.includes('@license') ? m : ''))
      .replace(/^[ \t]*\/\/(?!!).*(?:\r?\n|$)/gm, '')
    writeFileSync(p, out)
  }
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as {
  version: string
  exports: Record<string, unknown>
}
const { version } = pkg

/**
 * Public import paths. They follow the `exports` of package.json, which lists one path per feature module.
 * Adding a module does not need a change in this file.
 */
const modules = Object.keys(pkg.exports)
  .filter((k) => k !== '.' && k !== './package.json')
  .map((k) => k.slice(2))
const entry = Object.fromEntries([
  ['index', 'src/index.ts'],
  ...modules.map((m) => [m, `src/modules/${m}/index.ts`]),
])

/**
 * The published JavaScript has no source maps and no comments.
 * Only license comments and tree-shaking annotations (such as @__PURE__) stay.
 * Without the annotations, app bundlers could not drop unused code.
 */
const outputOptions = { comments: { legal: true, annotation: true, jsdoc: false } }

/**
 * Freezes the global `HiveAxylSDK` of the `<script>` bundle.
 * A script loaded later then cannot swap `createAxyl` to capture settings and tokens.
 * When the bundle runs as a classic script, its `var HiveAxylSDK` becomes a global property. Only then is that property made read-only and non-deletable.
 * When the bundle runs inside a function or a module, only the local variable is frozen and the global object is left alone.
 * This does not stop scripts that ran before the SDK, or paths through other built-in functions.
 * Every script on the page must be trusted, as the README "Page security" section explains.
 */
const iifeFooter =
  'Object.freeze(HiveAxylSDK);(function(d){if(d&&d.value===HiveAxylSDK&&d.writable)Object.defineProperty(globalThis,"HiveAxylSDK",{value:d.value,writable:false,configurable:false})})(Object.getOwnPropertyDescriptor(globalThis,"HiveAxylSDK"));'

/** Does not add `//#region src/...` comments with source paths. The `comments` option does not remove them. */
const inputOptions = { experimental: { attachDebugInfo: 'none' as const } }

/** The test servers that only the development build allows. */
interface TestServers {
  origin: string
  origins: readonly string[]
}

/**
 * Builds the configurations shared by the release build and the development build.
 * With `test`, the list of allowed servers also gets the default test server (`__AXYL_TEST_ORIGIN__`)
 * and the test servers per service (`__AXYL_TEST_ORIGINS__`). The release build never passes them.
 * The release build replaces both with the literal `undefined`.
 * The development build replaces them with a string literal and an array literal.
 * Without the replacement, the code would read a global variable, and another script on the page could add servers to the list.
 */
function buildConfigs(options: { outDir: string; test?: TestServers }): UserConfig[] {
  const { test } = options
  const define = {
    __SDK_VERSION__: JSON.stringify(version),
    __AXYL_TEST_ORIGIN__: test ? JSON.stringify(test.origin) : 'undefined',
    __AXYL_TEST_ORIGINS__: test ? JSON.stringify(test.origins) : 'undefined',
  }
  const release = test === undefined
  return [
    {
      entry,
      format: ['esm', 'cjs'],
      // Rolldown also puts shared code into one chunk for CJS, so the core is not copied into every entry.
      // Only the release build emits type declarations and checks the package.
      dts: release && { compilerOptions: { removeComments: false } },
      platform: 'browser',
      target: 'es2022',
      sourcemap: false,
      clean: true,
      outDir: options.outDir,
      define,
      inputOptions,
      outputOptions,
      hooks: { 'build:done': () => (release ? stripDtsComments(options.outDir) : undefined) },
      publint: release,
      attw: release && { profile: 'node16' },
    },
    {
      entry: { 'hiveaxyl-sdk': 'src/iife.ts' },
      format: ['iife'],
      // Differs from `HiveAxyl`, the global name of the Unity WebGL runtime, so the two can share a page.
      globalName: 'HiveAxylSDK',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      sourcemap: false,
      clean: false,
      outDir: options.outDir,
      define,
      inputOptions,
      outputOptions: { ...outputOptions, footer: iifeFooter },
    },
  ]
}

/** Returns `true` when `value` is exactly one https origin, with no path and no trailing `/`. */
function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

/**
 * Reads the test servers for the development build.
 * `AXYL_TEST_ORIGIN` holds the default test server.
 * `AXYL_TEST_ORIGINS` holds the test servers per service, separated by commas.
 * This file holds no server address, so no non-production address reaches the public repository.
 * The build stops unless every value is a single https origin and no value in the list repeats.
 * No path, empty entry, or other value gets into the list of allowed servers.
 */
function devTestServers(): TestServers {
  const origin = process.env['AXYL_TEST_ORIGIN'] ?? ''
  const origins = (process.env['AXYL_TEST_ORIGINS'] ?? '').split(',')
  const valid =
    isHttpsOrigin(origin) &&
    origins.every(isHttpsOrigin) &&
    new Set(origins).size === origins.length
  if (!valid) {
    throw new Error(
      'Dev build needs AXYL_TEST_ORIGIN set to an https origin and AXYL_TEST_ORIGINS set to comma-separated https origins without repeats. Use the dev build script, not tsdown --dev directly.',
    )
  }
  return { origin, origins }
}

/**
 * `npm run build` writes the release build to `dist/`.
 * `tsdown --dev` with `AXYL_TEST_ORIGIN` and `AXYL_TEST_ORIGINS` writes the development build to `dist-dev/`, which also accepts the test servers.
 * The npm package does not include `dist-dev/` (`files`), so the development build is never published.
 */
export default defineConfig((cli) =>
  'dev' in cli && cli.dev === true
    ? buildConfigs({ outDir: 'dist-dev', test: devTestServers() })
    : buildConfigs({ outDir: 'dist' }),
)
