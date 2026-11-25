# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-26

First release of the Hive Axyl JS SDK, a TypeScript SDK for browser (H5) games. It calls the same server APIs with the same rules as the Hive Axyl Unity SDK 1.0.

### Added

- `createAxyl({ appId, clientId, modules })` creates an SDK instance with the modules you register. Each instance keeps its own session.
- Feature modules, each imported from its own path: `auth`, `token`, `service`, `mailbox`, `coupon`, `analytics`, `payment` and `tcb`. Modules you do not register stay out of your bundle.
- Every call returns one of four result kinds: `success`, `outcome`, `unknownOutcome` or `failure`. Network, server and browser problems never throw.
- Automatic token refresh after a 401, retries with backoff for idempotent requests, and per-call cancellation with `AbortSignal`.
- Refresh before a request and in `session.getAccessToken()` when the access token's expiry time has passed.
- Session events through `session.on()`: `change` for every sign-in state change with its reason, `expire`, `tokenrefresh` and `storagefallback`.
- `isDisposed()` tells whether a client was disposed, without throwing.
- An optional `logger` in `createAxyl`. Fields that may hold sensitive values arrive masked.
- Popup sign-in with `auth.openSignInPopup()`, page-redirect sign-in with `auth.startRedirectSignIn()` and `auth.completeRedirectSignIn()`, the payment window with `payment.openPaymentWindow()`, and `detectEnvironment()` to find in-app browsers and iframes.
- Tokens stay in memory only. The app gets the access token through `session.getAccessToken()` and never the refresh token.
- ES module, CommonJS and type declarations in the npm package `@com2usplatform/hiveaxyl`, and a `<script>` bundle that defines the global `HiveAxylSDK`.
- In the [example repository](https://github.com/com2usplatform/hiveaxyl-sdk-example-js) only: login and payment recipes to copy into your game (`recipes/`), their usage examples (`recipe-examples/`), a callback page for popup sign-in (`callback/`) and an integration guide (`INTEGRATION.md`).
