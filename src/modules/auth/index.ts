import { createBrowserWebAuth } from '../../browser/webauth'
import { isStopped } from '../../core/abort'
import { AxylUsageError } from '../../core/errors'
import { HOSTS } from '../../core/hosts'
import { definePrivilegedModule, type ModuleOptions } from '../../core/module'
import type { Operation } from '../../core/operation'
import { refused } from '../../core/refusal'
import { failure, type Failure } from '../../core/result'
import { cancelledIfDisposed, type SessionClearReason } from '../../core/session'
import { readCallOptions, type CallOptions } from '../../core/transport'
import type { RedirectSignInRequest } from '../../core/webauth'
import * as ops from './operations'
import { createRefresher } from './refresh'
import type * as T from './types'

/** The error for a request that throws while it is read. The message does not repeat the app's error. */
function unreadable(id: string): AxylUsageError {
  return new AxylUsageError(
    `${id} request body cannot be read. Pass plain values such as strings, numbers, arrays and objects.`,
  )
}

/**
 * Returns `req.body` as an object.
 * Throws `AxylUsageError` when `req` or its `body` is missing or not an object. That is an app code error.
 * A getter for `body` that throws also ends as `AxylUsageError`, and the message does not repeat the app's error.
 */
function bodyOf(id: string, req: unknown): Readonly<Record<string, unknown>> {
  let body: unknown
  try {
    body = (req as { readonly body?: unknown } | null | undefined)?.body
  } catch {
    throw unreadable(id)
  }
  if (typeof body !== 'object' || body === null) {
    throw new AxylUsageError(`${id} needs a request with a body object.`)
  }
  return body as Readonly<Record<string, unknown>>
}

/**
 * Copies `req.body` at the call and reads each field in `keys` once.
 * A spread copies the own fields. Then each field in `keys` that is not an own field is read and added.
 * A spread alone would drop a value that a class gives through a getter.
 * A spread keeps a `__proto__` key as a plain field, so it does not change the prototype of the copy.
 * The added fields are defined, not assigned, so a setter added to `Object.prototype` cannot take them.
 * The checks, the hash and the request all use this copy, so the value that was checked is the value that is sent.
 * A change the app makes to `req.body` later is not sent.
 * Throws `AxylUsageError` when `req` or its `body` is missing or not an object,
 * or when reading a field throws. The message does not repeat the app's error, so no value in it is shown.
 * It also throws when the body has a `toJSON` function, own or inherited.
 * The request is built with `JSON.stringify`, which would call that function after the hash and could send other values.
 */
function snapshotOf(id: string, req: unknown, keys: readonly string[]): Record<string, unknown> {
  const body = bodyOf(id, req)
  try {
    // The check on `body` covers a `toJSON` that a class gives, which the spread does not copy.
    // The copy's check covers a getter that gives a function only to the spread.
    if (typeof body['toJSON'] === 'function') throw unreadable(id)
    const copy: Record<string, unknown> = { ...body }
    if (typeof copy['toJSON'] === 'function') throw unreadable(id)
    for (const key of keys) {
      if (Object.hasOwn(copy, key)) continue
      Object.defineProperty(copy, key, {
        value: body[key],
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return copy
  } catch {
    throw unreadable(id)
  }
}

/**
 * Checks the password fields `keys` of `body` before they are hashed.
 * Throws `AxylUsageError` when a field is not a string. That is an app code error.
 * Returns a `failure` with `InvalidArgument` when a field is empty, so nothing is sent.
 * The hash of an empty string looks like any other hash, so the server cannot reject it.
 * Without this check, `createUsername` could create an account whose password is empty.
 */
function checkPasswords(
  id: string,
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Failure | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value !== 'string') {
      throw new AxylUsageError(`${id} body.${key} must be a string.`)
    }
    if (value === '') {
      return failure('InvalidArgument', `${id} body.${key} is empty. Nothing was sent.`)
    }
  }
  return undefined
}

/** Options for the `auth` module. */
export type AuthOptions = ModuleOptions

/**
 * Registers the authentication module.
 * Registering it also turns on automatic token refresh when a request gets a 401.
 * When the access token's expiry time is known and has passed, the SDK also refreshes before it sends a request.
 * The refresh goes to this module's `baseUrl`, so give `auth` and `token` the same `baseUrl`.
 * The login APIs return only an authorization code.
 * The `token` module exchanges the code for tokens and starts the session.
 * The login recipe in the example repository shows the full call order.
 *
 * Pass passwords as the player typed them.
 * A method that takes a password throws `AxylUsageError` when the request has no `body`, a password is not a string,
 * reading `body` or one of its fields throws, or `body` has a `toJSON` function.
 * The SDK hashes them with SHA-256 before sending, because the server does not accept plain text.
 * Do not hash them yourself, or they are hashed twice.
 * A method that hashes a password can also end before it sends the request:
 * - `failure` with `InvalidArgument`: a password is an empty string. Nothing was hashed or sent.
 * - `failure` with `Internal`: the browser could not hash the password.
 * - `failure` with `Cancelled`: the call's `signal` aborted or `dispose()` ran while the password was hashed.
 * - `failure` with `FailedPrecondition` and the `externalCode` `Auth_SessionChanged`: for a method that uses the session, another login or a logout replaced the session while the password was hashed.
 *
 * @example
 * createAxyl({ appId, clientId, modules: { auth: auth(), token: token() } })
 */
export function auth(options: AuthOptions = {}) {
  return definePrivilegedModule('auth', HOSTS.core, options, (ctx) => {
    const { call, privileged, lifetime } = ctx
    privileged.setRefresher(createRefresher(call, privileged.clientId, () => privileged.now()))

    /**
     * Calls an API that ends the session on the server, and clears the session when the call succeeds.
     * With `clearOnFailure`, it also clears it on a `failure` other than `Cancelled`. Each method's docs give the other results.
     * A sign-in that completed after the request started is kept. `reason` becomes the reason of the `change` event.
     * The app's `signal` and `dispose()` differ on purpose:
     * the `signal` counts as a cancel until the call returns, whatever the result,
     * while `dispose()` turns only a result that would clear the session into `Cancelled`, as in `token.issueToken`.
     */
    const endsSession = async <
      R extends { readonly kind: string; readonly error?: { readonly code: string } },
    >(
      reason: SessionClearReason,
      {
        clearOnFailure,
        signal,
      }: { readonly clearOnFailure: boolean; readonly signal: AbortSignal | undefined },
      start: () => Promise<R>,
    ): Promise<R | Failure> => {
      const generation = privileged.session.generation()
      const r = await start()
      // A cancel counts until the call returns. The app can cancel after the request returned and before the session is cleared.
      if (signal?.aborted)
        return r.kind === 'failure' && r.error?.code === 'Cancelled' ? r : refused('cancelled')
      const clearsOnThisFailure =
        clearOnFailure && r.kind === 'failure' && r.error?.code !== 'Cancelled'
      if (r.kind !== 'success' && !clearsOnThisFailure) return r
      return cancelledIfDisposed(privileged.session.clear(generation, reason)) ?? r
    }

    /**
     * Checks the password fields of a request, hashes them with the browser's Web Crypto, then sends the request.
     * `id` names the method in error messages. `keys` are the password fields of `req.body`.
     * The checks run first, before anything is hashed or sent:
     * - It throws `AxylUsageError` when `req` has no `body` object or a field in `keys` is not a string.
     * - It returns a `failure` with `InvalidArgument` when a field is empty.
     *   The hash of an empty string looks like any other hash, so the server cannot tell that nothing was typed.
     * It reads each field in `keys` once, so a password from a getter on a class is checked and hashed as given.
     * Hashing finishes before the request starts, so the state is checked again in between.
     * The results of a call that ends there are in the docs of `auth()`.
     * A cancel wins over a session change and over a failed hash. A call whose `signal` already aborted does not hash.
     * With `usesSession`, a request started for one player is never sent with another player's token.
     * A call made after `dispose()` and other app code errors (`AxylUsageError`) still throw.
     */
    const afterHashing = async <B extends object, R>(
      id: string,
      req: unknown,
      keys: readonly (keyof B & string)[],
      send: (hashed: B) => Promise<R>,
      {
        usesSession,
        signal,
        since,
      }: {
        readonly usesSession: boolean
        readonly signal: AbortSignal | undefined
        /** Session generation when the call started, if the caller already read the body. */
        readonly since?: number
      },
    ): Promise<R | Failure> => {
      privileged.assertAlive()
      // Read the generation before the body, so a getter that changes the session is caught too.
      const generation = usesSession ? (since ?? privileged.session.generation()) : undefined
      const body = snapshotOf(id, req, keys)
      const invalid = checkPasswords(id, body, keys)
      if (invalid !== undefined) return invalid
      const stopped = () => isStopped(lifetime, signal)
      if (stopped()) return refused('cancelled')
      let hashed: B
      try {
        hashed = await hashFields(body as B, keys)
      } catch (e) {
        // A call that hashes twice can see `dispose()` between the two hashes, and then the second one throws.
        // The call started before `dispose()`, so it ends as `Cancelled` like any call cut short by it.
        if (stopped()) return refused('cancelled')
        if (e instanceof AxylUsageError) throw e
        return failure('Internal', 'Could not hash the password in this browser.')
      }
      if (stopped()) return refused('cancelled')
      if (generation !== undefined && privileged.session.generation() !== generation) {
        return refused('sessionChanged')
      }
      return send(hashed)
    }

    /**
     * Returns a copy of `body` with each field in `keys` replaced by the SHA-256 hex of its raw password.
     * The spec forbids sending plain text.
     * `body` is the copy that `snapshotOf` made at the call, so its password fields are its own fields.
     * It hashes the fields one after another, in the order of `keys`.
     */
    const hashFields = async <B extends object>(
      body: B,
      keys: readonly (keyof B & string)[],
    ): Promise<B> => {
      const copy = { ...body }
      for (const key of keys) {
        copy[key] = (await privileged.hashPassword(copy[key] as string)) as B[typeof key]
      }
      return copy
    }

    /** Sends a username request after the SDK hashed its `password`. */
    const withHashedPassword = async <
      Req extends { readonly body: { readonly password: string } },
      Res,
      O extends string,
    >(
      operation: Operation<Req, Res, O>,
      req: Req,
      o: CallOptions | undefined,
    ) => {
      // Read the options once, so the signal that stops the hashing is the one the request gets.
      // `async` keeps a bad options value a rejected promise, as before, not an exception thrown at the call.
      const opts = readCallOptions(operation.id, o)
      return afterHashing(
        operation.id,
        req,
        ['password'],
        (body: Req['body']) => call(operation, { body } as Req, opts),
        { usesSession: false, signal: opts?.signal },
      )
    }

    /** The web auth adapter. The app's replacement wins. Otherwise the browser default is created on first use. */
    const webAuth = () => ctx.feature('webAuth', createBrowserWebAuth)

    return {
      /**
       * Opens a blank window for signing in with a provider, and returns its handle.
       * Call it on the first line of a click handler, before any `await`. Browsers open a window only during the click.
       * Then prepare the sign-in, such as `newPkce()`, and call `signIn` on the handle.
       * If you do not call `signIn`, call `close()`. Only one sign-in window runs at a time.
       *
       * It does not throw for browser reasons. `signIn` returns the result:
       * - `success`: the callback passed the checks. OAuth gives `code` and `state`. Steam gives `providerUserId` and `providerToken`.
       * - `outcome` (`user_canceled`): the player closed the window or cancelled at the provider.
       * - `failure` with `Unavailable` and `externalCode` `WebAuthPopupBlocked`: the browser blocked the window,
       *   or the page runs in an in-app browser. Use `startRedirectSignIn` instead, or ask the player to open a regular browser.
       *   In a portal iframe, the portal's `sandbox` or opener policy can also block it.
       *   Do not move the page there. Ask the player to open the game outside the portal.
       * - `failure` with `Unavailable` and no `externalCode`: the window opened, but the browser did not let it move
       *   to the sign-in page. The window closes. Ask the player to try again.
       * - `failure` with `FailedPrecondition`: another sign-in window is still open.
       * - `failure` with `InvalidArgument`: `redirectUri` is not on the game page origin, or an OAuth `redirectUri` contains `#`.
       *   It is also the result when the URL from `authorizationUrl` is not `https:`.
       *   On `localhost`, `127.0.0.1` or `[::1]`, `http:` also works.
       * - `failure` with `Cancelled`: `signal`, `close()` or `dispose()` ended it. The window closes, unless the browser cut the link to it.
       * - `failure` with `Internal` and `externalCode` `WebAuthCallbackURLParseFailed`: the callback could not be read.
       * - `failure` with `Unknown`: the provider returned an error. `externalCode` holds the provider's code.
       *
       * Host a callback page at `redirectUri`. It posts `location.href` to `window.opener`, with its own origin as the target,
       * then closes itself. The example repository includes one. The code is sensitive. Do not log or persist it.
       *
       * @example
       * button.onclick = async () => {
       *   const popup = axyl.auth.openSignInPopup() // first line, before any await
       *   const pkce = await axyl.auth.newPkce()
       *   const r = await popup.signIn({
       *     redirectUri: `${location.origin}/callback.html`,
       *     authorizationUrl: ({ state }) => buildProviderUrl(state),
       *   })
       *   if (r.kind === 'success') await finishSignIn(r.data.code, pkce)
       * }
       */
      openSignInPopup: () => webAuth().openPopup(lifetime),
      /**
       * Moves the whole page to the provider. Use it when a popup cannot open.
       * It saves `state`, `provider`, `redirectUri` and `codeVerifier` in `sessionStorage` until the page returns.
       * Set `redirectUri` to the game page, and call `completeRedirectSignIn()` when that page loads.
       * Returns `undefined` once the page starts to move. Otherwise it returns a `failure`:
       * - `InvalidArgument`: `redirectUri` is on another origin, or an OAuth `redirectUri` contains `#`.
       *   It is also the result when the URL from `authorizationUrl` is not `https:` (`http:` also works on a loopback host).
       * - `Unavailable`: the browser did not let the page move. The SDK tries to remove the saved values.
       *   They can remain when the browser refuses to remove them.
       *   A later return still needs a matching `state`.
       * - `FailedPrecondition`: a sign-in window is still open.
       * - `FailedPrecondition` with `Auth_RedirectStateMissing`: `sessionStorage` is blocked.
       */
      startRedirectSignIn: (request: RedirectSignInRequest) => webAuth().startRedirect(request),
      /**
       * Finishes a redirect sign-in. Call it once when the game page loads.
       * The page URL counts as a sign-in callback only when it has `state` together with `code`, `error` or `openid.mode`.
       * Otherwise it returns `null` and leaves the URL and the saved values alone, so a link such as `?code=COUPON1` still works.
       * For a callback it removes the saved values from `sessionStorage` at once.
       * It also removes `code`, `state`, `error`, `error_description`, `error_uri`, `iss` and every `openid.*` parameter
       * from the address bar. Do not use these query parameters for anything else on that page.
       * - `success`: the callback, with the `provider`, `redirectUri` and `codeVerifier` you passed.
       * - `outcome` (`user_canceled`): the player cancelled at the provider.
       * - `failure` with `FailedPrecondition` and `Auth_RedirectStateMissing`: the saved values are missing, damaged,
       *   or for another `state`. The sign-in may have started in another tab or browser. Start it again.
       * - `failure` with `Internal` and `WebAuthCallbackURLParseFailed`: the callback repeats a parameter, has no code,
       *   or a Steam callback does not match its `openid.return_to`.
       * - `failure` with `Unknown`: the provider returned an error. `externalCode` holds the provider's code.
       */
      completeRedirectSignIn: () => webAuth().completeRedirect(),
      /**
       * Creates a new PKCE value.
       * Create one for every login and never reuse it.
       * Pass `challenge` to the login API and `verifier` to `token.issueToken`.
       * It sends no request, so it does not return a result.
       * A call made after `dispose()` throws `AxylUsageError` at once, before it returns a promise.
       * Otherwise the promise rejects only when the browser's Web Crypto fails. The login recipe turns that into a `failure`.
       */
      newPkce: () => privileged.newPkce(),
      /**
       * Returns the `deviceKey` of this browser.
       * It is created and stored in browser storage when missing.
       * The client keeps the same value for its whole life.
       */
      deviceKey: () => privileged.deviceKey(),

      /**
       * Creates a new guest player and returns an authorization code.
       * The result has a `guestToken` for guest login.
       * Keep `guestToken` in memory or in `sessionStorage` under your game's own key.
       * Do not write it to `localStorage`, IndexedDB, cookies or logs. It stays valid until the player links a first sign-in provider.
       *
       * The server can answer with these `outcome` codes:
       * `invalid_grant_key`, `grant_required_missing`, `invalid_client_id`,
       * `ip_blocked`, `app_not_found`, and `provider_config_not_found`.
       */
      createGuest: (req: T.CreateGuestRequest, o?: CallOptions) => call(ops.createGuest, req, o),
      /**
       * Logs in again as an existing guest and returns an authorization code.
       *
       * The server can answer with these `outcome` codes:
       * `invalid_guest_token`, `invalid_client_id`, `ip_blocked`, and `app_not_found`.
       */
      loginGuest: (req: T.LoginGuestRequest, o?: CallOptions) => call(ops.loginGuest, req, o),
      /**
       * Gets the providers available to the app in the player's country.
       *
       * The server can answer with these `outcome` codes:
       * `app_not_found` and `provider_config_not_found`.
       */
      getProviderList: (o?: CallOptions) => call(ops.getProviderList, undefined, o),
      /**
       * Exchanges an authorization code from a provider for a provider token.
       * Pass the result to `loginProvider` or `linkProvider`.
       * The result holds a credential. Do not store it or write it to logs.
       *
       * The server can answer with these `outcome` codes:
       * `provider_not_supported`, `provider_token_exchange_not_supported`, `provider_token_error`,
       * `app_not_found`, `provider_config_not_found`,
       * `provider_client_info_not_exists`, and `provider_request_failed`.
       */
      exchangeProviderToken: (req: T.ExchangeProviderTokenRequest, o?: CallOptions) =>
        call(ops.exchangeProviderToken, req, o),
      /**
       * Logs in or signs up with a provider account and returns an authorization code.
       *
       * The server can answer with these `outcome` codes:
       * `provider_token_error`, `invalid_client_id`, `ip_blocked`,
       * `app_not_found`, `provider_config_not_found`, `provider_client_info_not_exists`,
       * and `provider_request_failed`.
       */
      loginProvider: (req: T.LoginProviderRequest, o?: CallOptions) =>
        call(ops.loginProvider, req, o),
      /**
       * Links a provider account to the logged-in player.
       * For `USERNAME`, pass the raw password as `providerToken`.
       * The SDK sends its SHA-256 hex, because the spec requires `SHA256(raw_password)`.
       * Write `USERNAME` exactly, in upper case and without spaces.
       * Another spelling such as `username` or `' USERNAME'` throws `AxylUsageError`,
       * so the raw password is never sent unhashed.
       * For every provider, a request without a `body` object, or with a `body` that has a `toJSON` function,
       * throws `AxylUsageError` too.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `invalid_username_format`,
       * `invalid_password_format`, `provider_token_error`, `provider_request_failed`,
       * `provider_client_info_not_exists`, `username_verify_failed`, `username_already_exists`,
       * `ip_blocked`, `app_not_found`, `player_not_found`,
       * `provider_config_not_found`, `provider_type_already_exists`, `provider_owned_by_other`,
       * and `provider_already_connected`.
       */
      linkProvider: async (req: T.LinkProviderRequest, o?: CallOptions) => {
        privileged.assertAlive()
        const opts = readCallOptions('linkProvider', o)
        const since = privileged.session.generation()
        // One copy decides the path and is sent, so `providerId` cannot change between the two.
        const body = snapshotOf('linkProvider', req, ['providerId', 'providerToken'])
        const providerId: unknown = body['providerId']
        if (
          typeof providerId === 'string' &&
          providerId !== 'USERNAME' &&
          providerId.trim().toUpperCase() === 'USERNAME'
        ) {
          throw new AxylUsageError(`providerId must be 'USERNAME', not '${providerId}'.`)
        }
        if (providerId !== 'USERNAME') {
          // Send only the copy. Spreading `req` would read a `body` getter again.
          return call(ops.linkProvider, { body } as T.LinkProviderRequest, opts)
        }
        return afterHashing(
          'linkProvider',
          { body },
          ['providerToken'],
          (hashed: T.LinkProviderRequest['body']) => call(ops.linkProvider, { body: hashed }, opts),
          { usesSession: true, signal: opts?.signal, since },
        )
      },
      /**
       * Unlinks a provider account from the logged-in player.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `provider_not_supported`, `provider_not_exist`,
       * `guest_unlink_blocked`, `last_provider_unlink_blocked`, `ip_blocked`,
       * and `app_not_found`.
       */
      unlinkProvider: (req: T.UnlinkProviderRequest, o?: CallOptions) =>
        call(ops.unlinkProvider, req, o),
      /**
       * Gets a new authorization code with an access token that the caller already has.
       * Pass the token as `options.accessToken`.
       * In the Unity SDK, an app uses it to restore a session from a stored access token.
       * This SDK keeps tokens in memory only, so the login recipe does not use this API.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `invalid_client_id`,
       * `ip_blocked`, `app_not_found`, and `player_not_found`.
       */
      loginWithAccessToken: (req: T.LoginWithAccessTokenRequest, o?: CallOptions) =>
        call(ops.loginWithAccessToken, req, o),
      /**
       * Logs out.
       * The session is cleared when the server confirms the logout,
       * and also on a `failure` other than `Cancelled`, such as a network error or a 5xx.
       * A guest-only account gets the `guest_signout_blocked` outcome and keeps the session.
       * A `Cancelled` result keeps the session even when the server already signed the player out.
       * The next token refresh then fails and ends the session.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `app_not_found`,
       * `player_not_found`, and `guest_signout_blocked`.
       */
      logoutPlayer: async (o?: CallOptions) => {
        const opts = readCallOptions('logoutPlayer', o)
        // A failure also clears the session. The player asked to sign out, and an unanswered request does not take that back.
        // This matches the logout flow that the Unity SDK documents.
        return endsSession('logout', { clearOnFailure: true, signal: opts?.signal }, () =>
          call(ops.logoutPlayer, undefined, opts),
        )
      },
      /**
       * Creates a username account and returns an authorization code.
       * Pass the raw password. The SDK hashes it.
       *
       * The server can answer with these `outcome` codes:
       * `invalid_grant_key`, `grant_required_missing`, `invalid_client_id`,
       * `ip_blocked`, `app_not_found`, `provider_config_not_found`, and `username_already_exists`.
       */
      createUsername: (req: T.CreateUsernameRequest, o?: CallOptions) =>
        withHashedPassword(ops.createUsername, req, o),
      /**
       * Logs in with a username and returns an authorization code.
       * Pass the raw password. The SDK hashes it.
       *
       * The server can answer with these `outcome` codes:
       * `username_verify_failed`, `invalid_client_id`, `ip_blocked`,
       * `app_not_found`, and `provider_config_not_found`.
       */
      loginUsername: (req: T.LoginUsernameRequest, o?: CallOptions) =>
        withHashedPassword(ops.loginUsername, req, o),
      /**
       * Changes the username password.
       * Pass both passwords raw. The SDK hashes them.
       * On success the server revokes the sessions on every device, so the SDK clears the session.
       * Log in again with the new password.
       * The server may still be revoking the old sessions right after this call. How long that takes depends on the server.
       * A sign-in right after can end as `invalid_grant` when the token is issued. Ask the player to sign in again a moment later.
       * On any other result the session stays, so the player can try again.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `same_password`, `username_verify_failed`,
       * `ip_blocked`, `app_not_found`, `provider_not_exist`,
       * `username_not_found`, and `token_revoke_failed`.
       */
      changeUsernamePassword: async (req: T.ChangeUsernamePasswordRequest, o?: CallOptions) => {
        const opts = readCallOptions('changeUsernamePassword', o)
        return afterHashing(
          'changeUsernamePassword',
          req,
          ['currentPassword', 'newPassword'],
          (hashed: T.ChangeUsernamePasswordRequest['body']) =>
            // A failure keeps the session, so the player can try again.
            endsSession('passwordChanged', { clearOnFailure: false, signal: opts?.signal }, () =>
              call(
                ops.changeUsernamePassword,
                // Only the two passwords go in the body.
                {
                  body: {
                    currentPassword: hashed.currentPassword,
                    newPassword: hashed.newPassword,
                  },
                },
                opts,
              ),
            ),
          { usesSession: true, signal: opts?.signal },
        )
      },
      /**
       * Logs in or signs up with a custom provider and returns an authorization code.
       * The app server issues the `grantKey`.
       *
       * The server can answer with these `outcome` codes:
       * `invalid_grant_key`, `provider_not_supported`, `invalid_client_id`,
       * `ip_blocked`, `app_not_found`, and `provider_config_not_found`.
       */
      loginCustomProvider: (req: T.LoginCustomProviderRequest, o?: CallOptions) =>
        call(ops.loginCustomProvider, req, o),
      /**
       * Links a custom provider to the logged-in player.
       * The app server issues the `grantKey`.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `invalid_grant_key`, `player_id_does_not_match`,
       * `provider_not_supported`, `provider_type_already_exists`, `provider_owned_by_other`,
       * `provider_already_connected`, `ip_blocked`, `app_not_found`,
       * `player_not_found`, and `provider_config_not_found`.
       */
      linkCustomProvider: (req: T.LinkCustomProviderRequest, o?: CallOptions) =>
        call(ops.linkCustomProvider, req, o),
      /**
       * Gets the usage restriction status of the logged-in player.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `app_not_found`,
       * `block_type_not_found`, and `block_type_content_not_found`.
       */
      getBlockStatus: (o?: CallOptions) => call(ops.getBlockStatus, undefined, o),
      /**
       * Deletes the player's account for this game.
       * On success the server revokes the sessions on every device, so the SDK clears the session.
       * On any other result the session stays, so the player can try again.
       *
       * The server can answer with these `outcome` codes:
       * `app_id_mismatch`, `invalid_gateway_context`, `app_not_found`,
       * `player_not_found`, and `token_revoke_failed`.
       */
      withdrawPlayer: async (o?: CallOptions) => {
        const opts = readCallOptions('withdrawPlayer', o)
        // A failure keeps the session, so the player can try again.
        return endsSession('withdrawn', { clearOnFailure: false, signal: opts?.signal }, () =>
          call(ops.withdrawPlayer, undefined, opts),
        )
      },
    }
  })
}

/** The API that the `auth` module adds to the client. */
export type AuthModule = ReturnType<typeof auth>
export type * from './types'
export type { Pkce } from '../../core/crypto'
export type { PopupOptions } from '../../core/popup'
export type {
  AuthorizationValues,
  OAuthCallback,
  OpenIdCallback,
  RedirectSignIn,
  RedirectSignInRequest,
  SignInPopup,
  SignInProtocol,
  SignInRequest,
  SignInResult,
} from '../../core/webauth'
