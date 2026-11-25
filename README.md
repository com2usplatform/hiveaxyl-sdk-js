# Hive Axyl JS SDK

> **Official repository** of Com2uS Platform.
> Canonical URL: https://github.com/com2usplatform/hiveaxyl-sdk-js

|           |                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product   | Hive Axyl                                                                                                                                                                                                                                                                                                                                                                                         |
| Domain    | sdk                                                                                                                                                                                                                                                                                                                                                                                               |
| Version   | 1.0.1. Changes are in [`CHANGELOG.md`](CHANGELOG.md)                                                                                                                                                                                                                                                                                                                                              |
| Lifecycle | Active                                                                                                                                                                                                                                                                                                                                                                                            |
| Related   | [hiveaxyl-sdk-unity](https://github.com/com2usplatform/hiveaxyl-sdk-unity): the Unity SDK this SDK follows. [hiveaxyl-sdk-example-js](https://github.com/com2usplatform/hiveaxyl-sdk-example-js): the recipes, examples, callback page and integration guide for this SDK. [hiveaxyl-sdk-example-unity](https://github.com/com2usplatform/hiveaxyl-sdk-example-unity): Unity recipes and examples |

A TypeScript SDK that calls the Hive Axyl server APIs from browser H5 games. It uses the same server APIs and the same rules as the Hive Axyl Unity SDK 1.0.
The SDK keeps tokens in memory only, so players, guests included, sign in again after a page reload ([Rules for your app](#rules-for-your-app)).

<!-- This file ships in the npm package. Keep internal addresses, issue keys and test server addresses out of it. Do not link to development documents that exist only in the repository. -->

## Contents

- [Installation](#installation)
- [Browser support](#browser-support)
- [Usage](#usage)
- [Recipes](#recipes)
- [Rules for your app](#rules-for-your-app)
- [Failure codes](#failure-codes)
- [Logs when the tab closes](#logs-when-the-tab-closes)
- [Back/forward cache](#backforward-cache)
- [How long a call can wait](#how-long-a-call-can-wait)
- [Popups: sign-in with a provider and the payment window](#popups-sign-in-with-a-provider-and-the-payment-window)
- [Add-ons](#add-ons)
- [Page security](#page-security)
- [Browser storage](#browser-storage)
- [Troubleshooting and testing](#troubleshooting-and-testing)
- [Coming from the Unity SDK](#coming-from-the-unity-sdk)
- [What works now](#what-works-now)
- [Related repositories](#related-repositories)
- [Package contents](#package-contents)
- [Support](#support)
- [License](#license)

## Installation

Install it from npm:

```sh
npm install @com2usplatform/hiveaxyl
```

Each GitHub release also attaches the same package file (`.tgz`). Without the npm registry, download it and run `npm install ./<file>.tgz`.

A game without a build tool loads `dist/hiveaxyl-sdk.iife.js` from the package with a `<script>` tag. It defines the global `HiveAxylSDK`, which holds `createAxyl` and every module. Pin the exact version and add Subresource Integrity ([Page security](#page-security)).

The [Install](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/INTEGRATION.md#install) section of the integration guide shows the pinned `<script>` tag and how to compute its `integrity` hash.

## Browser support

The build targets ES2022. The SDK needs one of these browsers or a later version:

| Browser            | Oldest version |
| ------------------ | -------------- |
| Chrome and Edge    | 93             |
| Firefox            | 92             |
| Safari, iOS Safari | 15.4           |

- Every browser on iOS uses WebKit, so iOS 15.4 applies to all of them.
- The SDK uses `Object.hasOwn` and `Array.prototype.at` without a fallback. They set this floor. An older browser fails with a `TypeError` or cannot load the bundle.
- The SDK checks for `crypto.randomUUID`, `BroadcastChannel` and browser storage, and works without them.
- Firefox before 133 ignores fetch `keepalive`. Logs still go out, but closing the tab can cancel them.
- The recipes and the callback page need nothing newer.
- The oldest versions in the table are not tested yet.

## Usage

Register only the feature modules you use. Modules you do not register stay out of your bundle.

```ts
import { createAxyl } from '@com2usplatform/hiveaxyl'
import { auth } from '@com2usplatform/hiveaxyl/auth'
import { coupon } from '@com2usplatform/hiveaxyl/coupon'
import { token } from '@com2usplatform/hiveaxyl/token'

const created = createAxyl({
  appId,
  clientId,
  modules: { auth: auth(), token: token(), coupon: coupon() },
})
if (created.kind === 'failure') throw new Error(created.error.message)
const axyl = created.client

const r = await axyl.coupon.redeemCoupon({ body: { couponCode: 'ABCD1234' } })
// Every call returns one of four kinds of result.
//   success         The call worked. `r.data` holds the response.
//   outcome         The server handled the call but declined it. `r.code` says why, for example `coupon_already_used`.
//   unknownOutcome  The server sent a result code this SDK does not know. The server may have added a new code.
//   failure         A network, server or browser problem. `r.error.code` says why.
if (r.kind === 'success') showReward(r.data.mailId)
```

Network, server and browser problems never throw. They come back as a `failure`. The SDK throws `AxylUsageError` only when your code must change, for example for an invalid setting.

Redeeming a coupon needs a signed-in session. For sign-in, copy the login recipe (`recipes/login.ts` in the [example repository](https://github.com/com2usplatform/hiveaxyl-sdk-example-js)) into your app. It needs the `auth` and `token` modules. Create one login flow per client and share it.

```ts
const login = createLogin(axyl, { clientId })
const r = await login.guest() // success, businessOutcome or failure
```

Show the sign-in screen on a sign-out from the session `change` event. Enter the game from the sign-in result after the `isBlock` check. `change` reports sign-in, sign-out and session expiry. `reason` may gain new values, so accept unknown ones. Unlike some libraries, subscribing does not send the current state. Read it with `isSignedIn()`.

```ts
if (!axyl.session.isSignedIn()) showLoginScreen()
axyl.session.on('change', ({ state, reason }) => {
  if (state === 'signedOut') showLoginScreen(reason)
})
```

Listeners run before the call that changed the session returns. Start a follow-up call as follows:

- Start a follow-up login or logout from that recipe call's result.
- While a login recipe call runs, such as a sign-in with its window open, any different call to the same login flow returns a `failure` with `Aborted` until it ends.
- That includes a call made directly from a listener for that call's event.
- When the event came from that recipe call and the next call must start from the listener, defer it with `setTimeout`. A `queueMicrotask` or `Promise.resolve().then` runs too early.
- An event from elsewhere, such as an expired session, can arrive while a call runs. Then a `setTimeout` does not help: the different call still returns `Aborted` until the running call ends.

For a first integration, follow the [integration guide](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/INTEGRATION.md). It covers the console, the page, your game server and a review checklist for code that an AI agent wrote.

## Recipes

The recipes hold the call order of sign-in and payment flows. Copy them from the [example repository](https://github.com/com2usplatform/hiveaxyl-sdk-example-js) into your game. The [recipe guide](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/recipes/README.md) explains each function and its results.

The login recipe (`recipes/login.ts`):

- Check `isBlock` on a sign-in result before gameplay starts. A new guest's `isBlock` is always `false`, because the creation response reports no restriction. Call `auth.getBlockStatus()` if you need it.
- `username()` creates the account when the username has none. Tell the player when `isNewAccount` is true.
- `custom()` needs a fresh one-time grant key from your game server for every call.
- When your game server can issue grant keys, pass a fresh one as `grantKey` to `guest()` and `username()` on every call. A console that requires keys refuses a new account without one, with `grant_required_missing`.
- On `provider_owned_by_other` or `provider_type_already_exists` from `linkProvider()`, let the player decide. Never switch accounts or unlink a provider automatically.
- The first successful `linkProvider()` makes that player's guest credential stop working. Drop the credential when its `guestPlayerId` equals the result's `playerId`. `provider_already_connected` and `provider_type_already_exists` also mean this player already has a link, so drop it then too. Those results carry no `playerId`, so read `axyl.session.playerId()` before the call.
- Steam sign-in needs a Steamworks Publisher Web API Key in the Hive Axyl console, without an IP limit. A user Web API Key ends the sign-in with `provider_request_failed`. See [Steam Web API Key](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/INTEGRATION.md#steam-web-api-key) in the integration guide.
- Apple sign-in uses Apple JS by default, the script Apple publishes for the web. Call the recipe's `preloadAppleJs()` when the sign-in screen opens, and allow Apple JS in your Content Security Policy ([Page security](#page-security)).
- The integration guide covers the [Apple setup](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/INTEGRATION.md#prepare-the-console), including the optional Hive Axyl relay (`appleRelayUri`). The recipe guide's [Provider sign-in](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/recipes/README.md#provider-sign-in) says what the recipe does for each provider.
- `businessOutcome` and `failure` carry `step`, where the call stopped. Log it with the code.
- After `login.logout()`, `sessionCleared` says whether that call signed the player out, whatever `kind` is.

The payment recipe (`recipes/payment.ts`) is described under [Payment window](#payment-window).

## Rules for your app

- Serve the game over HTTPS. `localhost` also works. On other pages `createAxyl` returns a `failure`.
- Do not store the access token in browser storage, logs or analytics.
- Keep the guest credential in `sessionStorage` only, under your game's own key, as in the [guest login example](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/recipe-examples/guest-login.ts). It survives a reload and goes away when the tab is closed for good. A browser that reopens a closed tab or restores a session brings it back. A duplicated tab copies it.
- Do not put the guest credential in `localStorage`, IndexedDB, cookies, logs or analytics: it stays valid until the player links a first sign-in provider, so on a shared computer the next person would get the account.
- A guest who closes the tab before linking the account gets a new guest account next time, and loses what the old one bought. Tell guest players this. Let them link another sign-in method before they build progress or buy items worth keeping.
- Players sign in again after a page reload. Show the sign-in screen. Do not try to restore a session from storage. A "Play as guest" press signs a saved guest back in. Do not call `restoreGuest()` on page load.
- Send the access token only to your own game server. The server checks the player with it. The SDK never gives out the refresh token.
- The SDK never confirms a payment. Your game server must verify the receipt before it grants items. It verifies with the paying player's access token, not with server credentials.
- Choose the player's message by result code. `message` text is for developers.
- Log only a result's `kind`, `code`, `error.code`, `error.externalCode`, trace ID (`traceId`, or `error.traceId` for a `failure`) and, for a recipe result, `step`. Never log or report the whole result. Its `raw` holds the response body as sent, which can include a payment receipt (`axylReceipt`) or a payment page URL.
- One `failure` does not mean the session expired. Treat the player as signed out only when `session.on('change')` says so.
- A failed query is not an empty list. Keep showing the last data and offer a retry.
- Give every `switch` on a result kind, `reason` or enum value a `default` branch. Later versions may add values.
- Pass passwords as the player typed them. The SDK sends their SHA-256 hash.
- The later sign-in wins. The server keeps one session for each account and device. Tabs and clients of your site in one browser profile count as one device while browser storage keeps the device key. When the same account signs in on another tab or client, this session ends at its next token refresh. The SDK then sends `expire` and `session.on('change')` with `refreshRejected`. The SDK does not share sessions between tabs.
- One client is enough for most games. Several clients on one page each keep their own session. For the same account, the later sign-in wins as above. When a development server reloads your code, `dispose()` the old client before you create a new one. `isDisposed()` tells whether a client was disposed, without throwing.

## Failure codes

A `failure` result carries `r.error.code`. Choose the player's message by this code. `r.error.message` is for developers. `r.error.externalCode` gives a more specific code when there is one.

| Code                 | When it happens                                                                                                                                                                                                                                                                                                                                                                                      | What your app does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cancelled`          | Your code stopped the call with `signal` or `dispose()`                                                                                                                                                                                                                                                                                                                                              | Only the SDK stopped waiting. As with `unknownOutcome`, the server may still have done the work. Check the state before you send the request again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Unknown`            | A 4xx status with no specific mapping, or an error from a sign-in provider (`externalCode` holds its code)                                                                                                                                                                                                                                                                                           | Show a general error. Report `externalCode` and `traceId`. The SDK does not retry it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `InvalidArgument`    | HTTP 400 or 422, or the SDK rejected an argument before sending                                                                                                                                                                                                                                                                                                                                      | Fix the request in your code. The same request gets the same answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DeadlineExceeded`   | The request ran out of time, or HTTP 504                                                                                                                                                                                                                                                                                                                                                             | Offer a retry. The SDK already retried GET, PUT and DELETE. A POST or PATCH may have reached the server, so check the state first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `NotFound`           | HTTP 404                                                                                                                                                                                                                                                                                                                                                                                             | Do not send it again unchanged. `externalCode` holds the server code when there is one. `HTTP 404` means the server found no such API or resource                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AlreadyExists`      | HTTP 409                                                                                                                                                                                                                                                                                                                                                                                             | Do not send it again unchanged. Read the current state and continue from it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PermissionDenied`   | HTTP 403, or the request URL is not an allowed Hive Axyl server                                                                                                                                                                                                                                                                                                                                      | Do not send it again unchanged. The player or the app is not allowed to do this. `externalCode` gives the reason. Without it, check `baseUrl`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ResourceExhausted`  | HTTP 429, a `Retry-After` that asks for too long a wait, or too many requests waiting for a token refresh                                                                                                                                                                                                                                                                                            | Let the player try again after a while. Do not retry in a loop. The SDK already retries a 429                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `FailedPrecondition` | The page cannot run the SDK, such as outside a secure context (`Env_InsecureContext`). From `createAxyl` without `externalCode`: the browser lacks Web Crypto. Another sign-in window is still open. A redirect sign-in came back without its saved values (`Auth_RedirectStateMissing`). The sign-in state changed during the call (`Auth_SessionChanged`). The call was not sent as the new player | Serve the game over HTTPS (`localhost` also works). Without Web Crypto, ask the player to update or switch the browser. For a sign-in window, wait for the open one to end. For `Auth_RedirectStateMissing`, start the sign-in again in this tab. For `Auth_SessionChanged` from `openPayment()`, sign in as the player who paid and call `recoverPurchases()`. Offer a new payment only after that lookup found nothing: the player may already have paid in the old window. From `recoverPurchases()`, call it again for the player now signed in. From other calls, call again only if the player now signed in should make it |
| `Aborted`            | The session changed while a sign-in registered its tokens, or another sign-in or sign-out was still running. From the payment recipe: another `openPayment()` is still running (`Payment_InProgress`), or a `closePurchase()` of the same purchase is still running (`Payment_CloseInProgress`)                                                                                                      | Sign in again. For `Payment_InProgress`, wait for the open payment to end. For `Payment_CloseInProgress`, use the result of the first `closePurchase()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OutOfRange`         | A value was outside the allowed range                                                                                                                                                                                                                                                                                                                                                                | Not returned in this release. Handle it in your `default` branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Unimplemented`      | HTTP 501                                                                                                                                                                                                                                                                                                                                                                                             | Do not retry. The server does not support this API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Internal`           | HTTP 500 or an unexpected status, an unreadable response, or a failed browser feature such as Web Crypto                                                                                                                                                                                                                                                                                             | Show a general error and offer a retry later. Report `traceId`. The SDK already retried a 500 for GET, PUT and DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Unavailable`        | The network or the server is unavailable. Without `externalCode`: a token refresh failed without a verdict, or the browser did not let a sign-in window, a payment window or the page move to its next page                                                                                                                                                                                          | Check `externalCode` for the detail. Without it, let the player try again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `DataLoss`           | Data was lost or corrupted                                                                                                                                                                                                                                                                                                                                                                           | Not returned in this release. Handle it in your `default` branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Unauthenticated`    | HTTP 401, or the session ended because the server rejected its refresh token. A call whose 401 arrives after that end returns `FailedPrecondition` with `Auth_SessionChanged` instead                                                                                                                                                                                                                | Do not treat the player as signed out from this result alone. Wait for `session.on('change')` to say so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Logs when the tab closes

`analytics` requests go out with `keepalive` when they fit the browser limit. Then closing the tab right after `collectClientLog` does not cancel them. You need no `pagehide` handler for logs. Firefox supports `keepalive` from version 133.

- The limit is 64 KiB in total for the bodies of `keepalive` requests in progress on one page. Every SDK client, `navigator.sendBeacon` and your own `keepalive` requests share it.
- The SDK keeps each client's requests under the limit. It does not split a larger log but sends it without `keepalive`, so closing the tab can cancel it. Keep a log that must survive the tab closing well under 64 KiB.
- If other `keepalive` requests already fill the limit, the browser rejects the request. The call ends as a `failure` with `Unavailable`, even if the tab stays open.
- Only a request that has gone out outlives the page. A call still waiting for a token refresh or a retry can be lost.
- Calling `dispose()` when the tab closes cancels logs still being sent, `keepalive` requests included.
- Logs do not depend on the `lifecycle` add-on ([Add-ons](#add-ons)).

## Back/forward cache

When the player goes back to the game page, the browser can restore it from its back/forward cache, with the client and its session as they were.

- The SDK does not react to the restore. When the expiry time is known, the next call that uses the session and `getAccessToken()` refresh an expired access token first. Otherwise the refresh after a 401 handles it.
- Chrome does not restore a page served with `Cache-Control: no-store` after sign-in, and sign-in responses carry `no-store`. The page loads again, and the player signs in again.

## How long a call can wait

With the default settings, a call that gets no response ends as a `failure` with `DeadlineExceeded`. If the token refresh after a 401 gets no response, it ends with `Unavailable` instead. The first six rows assume that the browser cannot read `Retry-After`.

| Call                                    | Sends                                           | Worst case       |
| --------------------------------------- | ----------------------------------------------- | ---------------- |
| GET, PUT, DELETE                        | Up to 4, with waits of about 1, 2 and 4 seconds | About 2 min 10 s |
| POST, PATCH                             | 1                                               | About 30 s       |
| POST, PATCH after a 429                 | Like a GET                                      | About 2 min 10 s |
| GET, PUT, DELETE with a 401             | Up to 8, two rounds of waits, 2 refresh waits   | About 5 min 15 s |
| POST, PATCH with a 401, no 429          | 2, 2 refresh waits                              | About 2 min      |
| POST, PATCH with a 429 and a 401        | Up to 8, like a GET                             | Like a GET       |
| With `Retry-After`                      | 4 attempts, 3 waits of 60 s, 1 refresh wait     | About 5 min 30 s |
| With `Retry-After`, a 401 and a refresh | 8 attempts, 6 waits of 60 s, 2 refresh waits    | About 11 min     |

- Each attempt has a 30-second limit for the whole response, body included.
- Each token refresh is sent once and can add up to 30 seconds.
- The SDK reads `Retry-After` when the browser can read it: on a 429, and on a 500, 502, 503 or 504 for GET, PUT and DELETE. It then waits that long, up to 60 seconds. A longer value ends the call at once with `ResourceExhausted` when a retry is left. On the last attempt, or with `maxRetries: 0`, it does not read the header. The call then ends with the code of that response, such as `Unavailable` for a 503.
- Before its first attempt, a call waits for a refresh that another call started. If the access token has expired, it refreshes first, and calls that come meanwhile wait for the same refresh. While the browser is offline, it does not refresh early. If that refresh gets no response, the call ends as if its request got none, and the session stays.
- Retries send the same token and do not wait for a refresh, as in the Unity SDK. A token that expires between attempts gets a 401, and the 401 refreshes it.
- After a 401, the call waits for one refresh and sends the request again at once with the new token. That send starts its own retries from the first attempt, with the backoff from 1 second. A call refreshes after a 401 at most once.

To stop waiting sooner, pass a `signal` or change the `network` settings. A call stopped by its signal ends as a `failure` with `Cancelled`. Older browsers, such as Safari before 16, lack `AbortSignal.timeout`. There, call `abort()` on an `AbortController` from `setTimeout`.

```ts
// Stop this call after 10 seconds, retries included.
const r = await axyl.coupon.redeemCoupon(
  { body: { couponCode: 'ABCD1234' } },
  { signal: AbortSignal.timeout(10_000) },
)

// Or shorten every call: 10 seconds per attempt and at most 1 retry.
const created = createAxyl({
  appId,
  clientId,
  modules,
  network: { timeoutMs: 10_000, maxRetries: 1 },
})
```

## Popups: sign-in with a provider and the payment window

Browsers open a window only while they handle a click. Open the window on the first line of the click handler, before any `await`. Then prepare the request and send the window to its URL.

The login recipe runs the whole provider flow for Google, X, Steam and Apple ([Recipes](#recipes)). `provider()` opens the window, has the server exchange the code, signs in, and falls back to the redirect below. `linkProvider()` links the account to the signed-in player and never moves the page. This section covers the direct calls. Use them only for a flow the recipe does not cover.

```ts
signInButton.onclick = async () => {
  const popup = axyl.auth.openSignInPopup() // first line, before any await
  const pkce = await axyl.auth.newPkce() // if this throws, call popup.close()
  const redirectUri = `${location.origin}/callback.html`
  const r = await popup.signIn({
    redirectUri,
    // The SDK creates `state`. Put it and the PKCE challenge in the provider's authorization URL.
    authorizationUrl: ({ state }) =>
      providerAuthorizeUrl({ state, redirectUri, codeChallenge: pkce.challenge }),
  })
  switch (r.kind) {
    case 'success': {
      // r.data has only `code` and `state`. The server exchanges the code with the matching verifier.
      const x = await axyl.auth.exchangeProviderToken({
        body: {
          providerId: 'GOOGLE',
          providerCode: r.data.code,
          redirectUri,
          codeVerifier: pkce.verifier,
        },
      })
      if (x.kind !== 'success') break // show a sign-in error
      // Then sign in with `auth.loginProvider` using `x.data.providerUserId`, `x.data.providerToken` and a new PKCE pair, and finish with `token.issueToken`, as the login recipe does.
      break
    }
    case 'outcome': // `user_canceled`: the player closed the window or cancelled. Show no error.
      break
    case 'failure': // `WebAuthPopupBlocked`: use the redirect below, or ask for a regular browser.
      break
    default:
      break
  }
}
```

- Only one sign-in window runs at a time. If you do not call `signIn`, call `popup.close()`.
- There is no time limit. To stop waiting, pass `{ signal: AbortSignal.timeout(ms) }`. The SDK then closes the window, unless the browser has cut the link to it, for example after a provider page sent a `Cross-Origin-Opener-Policy` header. The player closes such a window. Safari before 16 lacks `AbortSignal.timeout`. There, abort an `AbortController` from `setTimeout`.
- When the player closes the window, the result is `user_canceled` after a short wait.
- For Steam, pass `protocol: 'steamOpenId'` and use `returnTo` as `openid.return_to`. The result has `providerUserId` and `providerToken` for `auth.loginProvider`.

### Callback page

Host a callback page at `redirectUri` on the game's origin. For OAuth, `redirectUri` must not contain `#`. The [example repository](https://github.com/com2usplatform/hiveaxyl-sdk-example-js) includes one (`callback/`). It removes the callback parameters from its address bar, posts `location.href` to `window.opener` with its own origin as the target, and closes itself.

- Main path: the SDK accepts the URL only from the window it opened, from the origin of `redirectUri`. It ignores a URL without the `state` it created. A value that is not a usable URL, or a URL that repeats `code`, `state` or `error`, ends the sign-in with `WebAuthCallbackURLParseFailed`.
- Backup path: the page also posts the URL on the same-origin `BroadcastChannel` named `hiveaxyl-webauth:<state>`. The SDK listens only on the channel for its own `state`. Any page on the origin can post there, so the SDK ignores non-URL values, URLs without its `state` and URLs that repeat a parameter. A URL with its `state` ends the sign-in like the main path, including a failure when it has no code.
- The SDK ignores every other message and keeps waiting.
- If you write your own callback page, post only to your own origin. Never use `'*'` as the target origin: the URL holds the sign-in answer, and a page on another site that opened your callback page would receive it.

### When the link to the window is cut

A `Cross-Origin-Opener-Policy` header on the game page or the provider page can cut the link to the sign-in window. The window then looks closed at once, and the sign-in can end as `user_canceled`. Use at most `same-origin-allow-popups` on the game page. Like the Unity SDK, the SDK cannot tell a cut link from a player who closed the window. So when `user_canceled` comes right after the window opened, offer the redirect sign-in below as another button. The login recipe moves the page only when the popup is blocked, so this button calls `axyl.auth.startRedirectSignIn()` in your own code. When the game page loads again, the recipe's `completeProviderRedirect()` finishes that sign-in too.

- Cross-origin isolation cuts the link to sign-in and payment windows. A page that needs `SharedArrayBuffer`, such as a multithreaded WebAssembly build, sends `Cross-Origin-Opener-Policy: same-origin` with `Cross-Origin-Embedder-Policy`. The link is cut when the window moves to the provider or payment page on another origin, and the window then looks closed. A sign-in usually ends as `user_canceled` before the provider can answer, so offer the redirect sign-in as the only provider button. The payment window looks closed at once, and the payment recipe can return `notFound`, or `businessOutcome` with `payment_resource_not_found`, while the player is still paying. Offer the "check again" button that calls `recoverPurchases()`.
- In a portal iframe, the portal page's own `Cross-Origin-Opener-Policy` applies too, and you cannot change it. The backup path does not help there either: browsers keep the channel of a frame embedded by another site apart from the callback window.
- When a portal page on another origin sends `Cross-Origin-Opener-Policy: same-origin`, the browser opens the window but gives the game no handle to it. Sign-in and payment then end as `failure` with `Unavailable` and `WebAuthPopupBlocked`, not as `user_canceled` or `closed`. A blank window stays open. The SDK has no handle to it, so it cannot close it. Allowing popups does not help. When `detectEnvironment().inIframe` is `true`, ask the player to open the game outside the portal, in its own tab. Show the game's address too: a `sandbox` without `allow-popups` also stops the game from opening that tab itself.
- Do not offer the redirect sign-in inside an iframe. It would load the provider inside the frame, and providers such as Google refuse to show their sign-in pages there. Ask the player to open the game outside the portal instead. A guest does not carry over: the game outside the portal has separate storage. Suggest linking a sign-in provider first to a guest with progress or purchases.

### Redirect sign-in

When a popup cannot open, move the whole page instead. Set `redirectUri` to the game page.

```ts
axyl.auth.startRedirectSignIn({
  provider: 'GOOGLE',
  redirectUri: location.origin + '/',
  codeVerifier,
  authorizationUrl,
})

// When the game page loads:
const back = axyl.auth.completeRedirectSignIn() // null on a normal visit
```

With the login recipe, call only its `completeProviderRedirect()` when the page loads. Do not also call `completeRedirectSignIn()`: it removes the saved values, and the recipe then finds no sign-in to finish.

- The SDK keeps `state`, `provider`, `redirectUri` and `codeVerifier` in `sessionStorage` until the page returns.
- `completeRedirectSignIn()` treats the page URL as a callback only when it has `state` together with `code`, `error` or `openid.mode`. A link with only `?code=`, such as a coupon link, returns `null` and stays as it is.
- For a callback, the SDK removes the saved values at once. It also removes `code`, `state`, `error`, `error_description`, `error_uri`, `iss` and every `openid.*` parameter from the address bar. Do not use these query parameters for anything else on that page.
- A return in another tab or browser fails with `Auth_RedirectStateMissing`. Start the sign-in again.

### Payment window

The payment window works the same way, without a redirect fallback:

```ts
buyButton.onclick = async () => {
  const win = axyl.payment.openPaymentWindow() // first line, before any await
  // The payment recipe also records the attempt with `createPrePurchase` here. Its stored payload comes back on restore.
  const url = await axyl.payment.createPaymentUrl(request)
  if (url.kind !== 'success') return win.close()
  if (!url.data.payUrl) return win.close() // the response has no payment page URL
  await win.show(url.data.payUrl) // resolves with `closed` when the window closes
  // A closed window says nothing about the purchase. Check with `restorePurchases` and your game server.
}
```

The payment recipe (`recipes/payment.ts`) runs this whole order, including the restore lookup and the purchase record ([recipe guide](https://github.com/com2usplatform/hiveaxyl-sdk-example-js/blob/main/recipes/README.md#payment-recipe)). Each SDK call uses the session of the moment it is sent, so a request after a sign-in change would go out as the new player. The recipe therefore stops when the sign-in state changes between its steps (`Auth_SessionChanged` in [Failure codes](#failure-codes)). If you call the payment functions yourself, check `session.on('change')` between the steps in the same way. Comparing `session.playerId()` alone misses a new sign-in by the same player.

- If the sign-in state changed after `recoverPurchases()` or `openPayment()` returned a purchase, do not send that purchase to your game server and do not close it.
- Call `recoverPurchases()` after every sign-in and after each payment. A payment can finish after its window closed.
- After an `openPayment()` result that carries `purchase`, after `notFound`, a `payment_resource_not_found` without `purchase`, after a `failure` at the `restore` step, and after a `Cancelled` at the `storePurchase` step, call `recoverPurchases()` once more when the player next returns to the game. The window can look closed while the player is still paying in it.
- In Chromium and WebKit browsers, such as Chrome and Safari, cancelling does not close the window once it has moved to the payment page. The SDK cuts `opener` before the window moves to `payUrl`. The payment page then cannot reach the game. These browsers ignore `close()` on such a window. Firefox closes it. The call still ends as `Cancelled`. The player can still pay in that window. Call `recoverPurchases()` when the player next returns to the game.

### In-app browsers and iframes

Call `detectEnvironment()` at any time, also before `createAxyl`. It reports `inAppBrowser` (`kakaotalk`, `line`, `instagram`, `facebook`, `naver`, `androidWebView` or `null`) and `inIframe`. The SDK shows no message. Your app tells the player to open the game in a regular browser.

- In a known in-app browser, `openSignInPopup` opens no window and returns `WebAuthPopupBlocked`. The payment window still opens when the browser allows it.
- Google refuses sign-in in many in-app browsers that show pages in a WebView. The redirect sign-in can then stop on a Google error page. The login recipe moves the page in an in-app browser when you set `fallbackRedirectUri`. Check `detectEnvironment()` before you start a Google sign-in.
- In-app browser detection reads the User-Agent and is best effort. An app that does not mark its User-Agent, such as many apps that wrap a WebView, reports `null`.
- Inside an iframe the login recipe never moves the page, even with `fallbackRedirectUri`. A blocked popup there ends as `WebAuthPopupBlocked`. Ask the player to open the game outside the portal, in its own tab. Allowing popups helps only when the browser's popup blocker stopped the window, not when the portal's `sandbox` or opener policy did. A guest does not carry over to the game outside the portal.

## Add-ons

Add-ons are browser features that only some modules need. They hold no state beyond the flow in progress, store nothing but the redirect sign-in values, and ask for no permissions. Replace them through `createAxyl({ adapters })`, for example in tests.

| Add-on      | Used by   | What it does                                                                                                                                                        |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webAuth`   | `auth`    | Sign-in window, callback checks, redirect sign-in. It matches the WebAuth add-on of the Unity SDK                                                                   |
| `popup`     | `payment` | Opens a blank window, cuts `opener`, moves it to an `https:` URL and reports when it closes                                                                         |
| `lifecycle` | None      | Reports when the tab is hidden, shown again or closed. No module uses it in this release, so passing one through `adapters` has no effect. Logs do not depend on it |

## Page security

Any script on your page runs with the SDK's rights. A script that runs before the SDK can replace the browser functions it uses and read tokens. Let only scripts you trust run on the page.

- Load the SDK and call `createAxyl` before third-party scripts such as ads, analytics or chat widgets.
- On a page that a redirect sign-in returns to, finish the sign-in first with `completeProviderRedirect()` (or `completeRedirectSignIn()` when you call the SDK directly). It removes the callback code from the address. Load third-party scripts after that.
- Use a Content Security Policy. List only the script sources you need. Allow the Hive Axyl servers in `connect-src`:

  ```text
  connect-src 'self' https://core-api.hiveaxyl.com https://app-api.hiveaxyl.com https://commerce-api.hiveaxyl.com https://data-api.hiveaxyl.com
  ```

  Add `https://sandbox-commerce-api.hiveaxyl.com` while you test payments in the sandbox.
  For Apple sign-in with Apple JS, add `https://appleid.cdn-apple.com` to `script-src`. Apple JS then runs with the same rights as the SDK. The recipe loads it without an `integrity` hash, because the URL has no version and Apple can change the file behind it. Call `preloadAppleJs()` only on pages that offer Apple sign-in.

- If you load the `<script>` bundle from another origin, add Subresource Integrity: set `integrity` to the hash of that exact version and set `crossorigin="anonymous"`.
- Keep the client in a module or closure variable. Do not put it on `window` or another global, where any script could call `session.getAccessToken()`.
- A portal `<iframe>` with a `sandbox` attribute must include `allow-scripts`, `allow-same-origin`, `allow-popups` and `allow-popups-to-escape-sandbox`. Without `allow-scripts` the game does not run at all. Without `allow-same-origin` the game runs on an opaque origin, although `location.origin` still shows the page's origin. The callback page then cannot deliver the sign-in answer to the game, so sign-in does not complete. When the window closes, sign-in ends as `user_canceled`, even if the player finished signing in. Payment windows are not affected. Without `allow-popups`, sign-in and payment windows do not open. Without `allow-popups-to-escape-sandbox`, they open with the portal's sandbox, which can stop them from finishing. Sign-in and payment need no `allow` attribute. Give the portal operator a complete tag, with your game page as `src`:

  ```html
  <iframe
    src="https://game.example.com/play"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  ></iframe>
  ```

  The portal page's own `Cross-Origin-Opener-Policy` must also be `same-origin-allow-popups` or weaker ([When the link to the window is cut](#when-the-link-to-the-window-is-cut)).

- Set the game page's `Cross-Origin-Opener-Policy` to `same-origin-allow-popups` or a weaker value ([When the link to the window is cut](#when-the-link-to-the-window-is-cut)). A page that needs cross-origin isolation cannot do this. See that section for what to offer instead. Some provider and payment pages send their own. The browser console may then warn about blocked `window.closed` or `postMessage` calls. These warnings are expected. Check payments with `restorePurchases` whatever the window reported.

## Browser storage

The SDK stores the values below in the browser. It never stores tokens or guest credentials. Your game keeps the guest credential as [Rules for your app](#rules-for-your-app) says.

| Key                  | Where            | Purpose                                                                                                                                                                     | Lifetime                                                                                                                                                                              | How to remove                                                                                                                        |
| -------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `hiveaxyl:deviceKey` | `localStorage`   | Identifies this browser to the server. Guest sign-in sends it                                                                                                               | Until the site data is cleared                                                                                                                                                        | Clear the site data, or call `localStorage.removeItem('hiveaxyl:deviceKey')`. The SDK creates a new value the next time it needs one |
| `hiveaxyl:webauth`   | `sessionStorage` | Only for `startRedirectSignIn`. Holds the sign-in protocol, `state`, `provider`, `redirectUri` and `codeVerifier` while the page is away at the provider. It holds no token | Until `completeRedirectSignIn()` reads the callback, which removes it at once, or until the tab closes. If the browser does not let the page move, the SDK tries to remove it at once | Close the tab, or call `sessionStorage.removeItem('hiveaxyl:webauth')`                                                               |

When the browser blocks `localStorage`, as when it blocks site data or in a sandboxed iframe, the SDK keeps `deviceKey` in memory for this page session only. When `sessionStorage` is blocked, `startRedirectSignIn` returns a `failure` instead.

## Troubleshooting and testing

- Do not let a service worker handle requests to the Hive Axyl hosts. Caching or rewriting them can break retries, token refresh and cancellation.
- A page can load two copies of the SDK, for example the `<script>` bundle and an npm copy. Then `instanceof AxylUsageError` fails for errors from the other copy, so check `error.name === 'AxylUsageError'`. Modules from one copy cannot be registered with `createAxyl` from the other.
- The SDK writes no logs unless you pass a `logger`. Fields that may hold sensitive values arrive masked as `'***'`.
- Every entry has a `category` field, as in the Unity SDK: `Transport`, `TokenRefresh`, `Session` or `Core`.
- Like the Unity SDK, the SDK logs each request and each response at `info`. Filter by level if the console gets too busy. Do not send these logs through the `analytics` module: each analytics call is a request, so it logs again.

  ```ts
  const created = createAxyl({
    appId,
    clientId,
    modules,
    logger: {
      log: (level, message, fields) => {
        // Keep warnings and errors only. Remove this line to see every request.
        if (level === 'debug' || level === 'info') return
        console[level](message, fields)
      },
    },
  })
  ```

- To test your game code without a server, replace the transport adapter with a fake one. It sees every request as sent, including the `Authorization` header and the refresh token, so use it only in tests.

  ```ts
  const fake = {
    send: async (req) => ({
      status: 200,
      header: () => null,
      // Answer in the server's shape. A success body holds the result in `data`.
      text: async () => JSON.stringify({ data: { mailId: '1' } }),
    }),
  }
  const created = createAxyl({ appId, clientId, modules, adapters: { transport: fake } })
  ```

## Coming from the Unity SDK

The server APIs, result kinds, retries and token refresh rules match the Unity SDK 1.0, with five deliberate differences:

- A result that the server decided is never sent again, even when it arrives with a 5xx or a 429.
- Cancelling the request that started a token refresh does not stop the refresh. Other waiting requests do not fail.
- After a refresh ends without a verdict, a late 401 does not start another refresh.
- Before a request and in `session.getAccessToken()`, the SDK refreshes an access token whose expiry time has passed. The Unity SDK refreshes only after a 401. A browser tab can sleep for hours, and the app server should not get an expired token.
- When the sign-in state changes while a call waits for a token refresh or between retries, the call ends as `FailedPrecondition` with `Auth_SessionChanged`. So does a call whose 401 arrives after the session changed or ended, for example after a rejected refresh token ended it. The SDK does not send it with the new sign-in. The Unity SDK 1.0 has no such code. There the call can end as `Unavailable`, or a retry can go out with the old token.

Only the shape of the code follows web conventions. Where the browser changes the meaning, the name changes too.

| Unity SDK                                       | JS SDK                                       | Difference                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HiveBootstrap.Initialize(config, b => ...)`    | `createAxyl({ appId, clientId, modules })`   | Creates an instance. Returns a `failure` outside a secure context (HTTPS or localhost)                                                                                                                 |
| `b.AddMailbox(baseUrl)`                         | `modules: { mailbox: mailbox({ baseUrl }) }` | `payment({ sandbox: true })` works the same way                                                                                                                                                        |
| `HiveCore.Resolve<IMailboxService>()`           | `axyl.mailbox`                               | A module you did not register fails both at TypeScript compile time and at run time                                                                                                                    |
| `GetReceivedMailsAsync(request, context)`       | `getReceivedMails(request, options)`         | Returns a `Promise` instead of a `Task`                                                                                                                                                                |
| Result classes in `switch (result)`             | `r.kind`                                     | `success`, `outcome`, `unknownOutcome` or `failure`                                                                                                                                                    |
| `Failure.Problem`                               | `r.error`                                    | Field names start with a lowercase letter (`externalCode`)                                                                                                                                             |
| `RawResponse`                                   | `r.raw`                                      | Empty for responses that carry tokens. Also empty for any result other than `success` when the request carries credentials                                                                             |
| `ApiCallContext.Token`                          | `{ signal }` (`AbortSignal`)                 | Aborting ends the call with a `failure` (`Cancelled`)                                                                                                                                                  |
| `ApiCallContext.IdempotencyKey`                 | `{ idempotencyKey }`                         | Sent only to APIs whose spec declares it. An empty or whitespace-only key throws `AxylUsageError`, because every call would share it                                                                   |
| `ApiCallContext.WithAccessToken(token)`         | `{ accessToken }`                            | Used only by `loginWithAccessToken`. An empty value is a `failure` (`InvalidArgument`)                                                                                                                 |
| `ISessionManager.IsLoggedIn`, `PlayerId`        | `axyl.session.isSignedIn()`, `playerId()`    | IDs are strings, so values above 2^53 stay exact                                                                                                                                                       |
| `ISessionManager.AccessToken`                   | `await axyl.session.getAccessToken()`        | No refresh token. The Unity SDK can keep a session in secure storage that the app provides. Browsers have no secure storage, so tokens are not stored and there is no automatic sign-in after a reload |
| `SetSession()`, `ClearSession()`                | None                                         | A successful `token.issueToken` registers the session. A sign-out clears it unless it was cancelled or refused. A successful password change or account deletion clears it                             |
| `OnSessionExpired`                              | `session.on('expire')`                       | Fires only on expiry. `change` reports sign-out                                                                                                                                                        |
| `OnSessionRefreshed`                            | `session.on('tokenrefresh')`                 | Fires only on token refresh. `change` reports sign-in                                                                                                                                                  |
| None                                            | `session.on('change')`                       | Fires on every sign-in state change, with the reason                                                                                                                                                   |
| `ExpiresAtSec` (seconds)                        | `expiresAtMs` (milliseconds)                 | Different unit                                                                                                                                                                                         |
| `Unspecified` in enums                          | Strings                                      | Response enums keep unknown values as strings. Handle them in a default branch                                                                                                                         |
| Timeout as `Unavailable`, `Net_ConnectionError` | `DeadlineExceeded`, `Net_Timeout`            | Browsers tell a timeout apart from a connection error                                                                                                                                                  |
| The recipe hashes the password                  | Pass the password as typed                   | The SDK sends its SHA-256 hash. Hashing it yourself hashes it twice                                                                                                                                    |

## What works now

Core and these modules work:

- `auth` and `token`
- `service`
- `mailbox`: received and sent mail
- `coupon`
- `analytics`: client logs
- `payment`: the six APIs of the payment gateway flow: product list, pre-record, payment URL, purchase record, completion and recovery. It also has six more APIs as plain calls: `listStoreProductIds`, `requestPurchase`, `itemResult`, and the three subscription APIs
- `tcb`: Cloud Functions on Tencent CloudBase

The sign-in popup, the redirect sign-in parts, the payment window and `detectEnvironment()` work.

The login recipe supports guest sign-in, username and password sign-in and sign-up, sign-in with a grant key from your game server, sign-in and account linking with Google, X, Steam and Apple, and sign-out.

The payment recipe runs a PG purchase from the payment window to the close and recovers purchases that were not granted. It reports the failed step and builds `accountUuid` like the Unity SDK.

## Related repositories

- [Hive Axyl Unity SDK](https://github.com/com2usplatform/hiveaxyl-sdk-unity): the reference for server APIs and behavior.
- [Hive Axyl JS SDK examples](https://github.com/com2usplatform/hiveaxyl-sdk-example-js)
- [Hive Axyl Unity SDK examples](https://github.com/com2usplatform/hiveaxyl-sdk-example-unity)

## Package contents

The npm package holds only `dist/`, `llms.txt`, this README, `LICENSE` and `package.json`. The recipes (`recipes/`), their usage examples (`recipe-examples/`), the callback page (`callback/`) and the integration guide (`INTEGRATION.md`) are in the [example repository](https://github.com/com2usplatform/hiveaxyl-sdk-example-js) only. `llms.txt` is a short version of this README for AI coding agents.

## Support

GitHub Issues are not used as a support channel for this repository. Please use the channels below for questions, bug reports, feature requests and customer inquiries.

| Purpose                                  | Channel                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| Questions, bug reports, feature requests | <cs-platform@com2us.com>                              |
| Security vulnerabilities                 | Private report only, see [`SECURITY.md`](SECURITY.md) |

GitHub is not an official customer support channel, and we do not commit to response or resolution timelines here. External pull requests are not accepted. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
