import { AUTH_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type * as T from './types'

/** The server API spec that this module follows. */
export const SPEC = 'auth.openapi.yaml'

/*
 * Follows `auth.openapi.yaml`.
 * The server-only `issueGrant` is not included.
 * `outcomes` are the `AuthBusinessErrorResponse` codes of the 400 response.
 * The three `AxylErrorResponse` codes are `failures`.
 * A response that holds an authorization code, a guest token, or a provider token
 * sets `sensitiveResponse`, so `raw` is left empty.
 * A request that sends a password hash, a provider token or a grant key without such a response sets `sensitiveRequest`.
 * Its failures then keep neither `raw` nor the server's free text.
 */

export const createGuest = op<T.CreateGuestRequest, T.CreateGuestResponse>()({
  id: 'createGuest',
  method: 'POST',
  path: '/auth/v1/guest',
  credential: 'anonymous',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'invalid_grant_key',
    'grant_required_missing',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'provider_config_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const loginGuest = op<T.LoginGuestRequest, T.LoginResponse>()({
  id: 'loginGuest',
  method: 'POST',
  path: '/auth/v1/guest/login',
  credential: 'anonymous',
  ids: { request: ['guestPlayerId'], response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: ['invalid_guest_token', 'invalid_client_id', 'ip_blocked', 'app_not_found'],
  failures: AUTH_FAILURES,
})

export const getProviderList = op<void, T.GetProviderListResponse>()({
  id: 'getProviderList',
  method: 'GET',
  path: '/auth/v1/provider',
  credential: 'anonymous',
  outcomes: ['app_not_found', 'provider_config_not_found'],
  failures: AUTH_FAILURES,
})

export const exchangeProviderToken = op<
  T.ExchangeProviderTokenRequest,
  T.ExchangeProviderTokenResponse
>()({
  id: 'exchangeProviderToken',
  method: 'POST',
  path: '/auth/v1/provider/token',
  credential: 'anonymous',
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'provider_not_supported',
    'provider_token_exchange_not_supported',
    'provider_token_error',
    'app_not_found',
    'provider_config_not_found',
    'provider_client_info_not_exists',
    'provider_request_failed',
  ],
  failures: AUTH_FAILURES,
})

export const loginProvider = op<T.LoginProviderRequest, T.LoginResponse>()({
  id: 'loginProvider',
  method: 'POST',
  path: '/auth/v1/provider/login',
  credential: 'anonymous',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'provider_token_error',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'provider_config_not_found',
    'provider_client_info_not_exists',
    'provider_request_failed',
  ],
  failures: AUTH_FAILURES,
})

export const linkProvider = op<T.LinkProviderRequest, T.LinkProviderResponse>()({
  id: 'linkProvider',
  method: 'POST',
  path: '/auth/v1/provider/link',
  credential: 'session',
  sensitiveRequest: true,
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'invalid_username_format',
    'invalid_password_format',
    'provider_token_error',
    'provider_request_failed',
    'provider_client_info_not_exists',
    'username_verify_failed',
    'username_already_exists',
    'ip_blocked',
    'app_not_found',
    'player_not_found',
    'provider_config_not_found',
    'provider_type_already_exists',
    'provider_owned_by_other',
    'provider_already_connected',
  ],
  failures: AUTH_FAILURES,
})

export const unlinkProvider = op<T.UnlinkProviderRequest, T.EmptyResponse>()({
  id: 'unlinkProvider',
  method: 'POST',
  path: '/auth/v1/provider/unlink',
  credential: 'session',
  params: { body: 'body' },
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'provider_not_supported',
    'provider_not_exist',
    'guest_unlink_blocked',
    'last_provider_unlink_blocked',
    'ip_blocked',
    'app_not_found',
  ],
  failures: AUTH_FAILURES,
})

/**
 * Gets a new authorization code with an access token that the caller already has.
 * The caller passes the token as `options.accessToken`.
 * The Unity SDK uses it only for automatic login with a stored token.
 * The web SDK does not store tokens, so the login recipe does not use it.
 */
export const loginWithAccessToken = op<T.LoginWithAccessTokenRequest, T.LoginResponse>()({
  id: 'loginWithAccessToken',
  method: 'POST',
  path: '/auth/v1/session/login',
  credential: 'caller',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'player_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const logoutPlayer = op<void, T.EmptyResponse>()({
  id: 'logoutPlayer',
  method: 'POST',
  path: '/auth/v1/session/logout',
  credential: 'session',
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'app_not_found',
    'player_not_found',
    'guest_signout_blocked',
  ],
  failures: AUTH_FAILURES,
})

export const createUsername = op<T.CreateUsernameRequest, T.CreateUsernameResponse>()({
  id: 'createUsername',
  method: 'POST',
  path: '/auth/v1/username',
  credential: 'anonymous',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'invalid_grant_key',
    'grant_required_missing',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'provider_config_not_found',
    'username_already_exists',
  ],
  failures: AUTH_FAILURES,
})

export const loginUsername = op<T.LoginUsernameRequest, T.LoginResponse>()({
  id: 'loginUsername',
  method: 'POST',
  path: '/auth/v1/username/login',
  credential: 'anonymous',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'username_verify_failed',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'provider_config_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const changeUsernamePassword = op<T.ChangeUsernamePasswordRequest, T.EmptyResponse>()({
  id: 'changeUsernamePassword',
  method: 'PATCH',
  path: '/auth/v1/username/password',
  credential: 'session',
  sensitiveRequest: true,
  params: { body: 'body' },
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'same_password',
    'username_verify_failed',
    'ip_blocked',
    'app_not_found',
    'provider_not_exist',
    'username_not_found',
    'token_revoke_failed',
  ],
  failures: AUTH_FAILURES,
})

export const loginCustomProvider = op<T.LoginCustomProviderRequest, T.LoginResponse>()({
  id: 'loginCustomProvider',
  method: 'POST',
  path: '/auth/v1/custom/login',
  credential: 'anonymous',
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  sensitiveResponse: true,
  outcomes: [
    'invalid_grant_key',
    'provider_not_supported',
    'invalid_client_id',
    'ip_blocked',
    'app_not_found',
    'provider_config_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const linkCustomProvider = op<T.LinkCustomProviderRequest, T.LinkProviderResponse>()({
  id: 'linkCustomProvider',
  method: 'POST',
  path: '/auth/v1/custom/link',
  credential: 'session',
  sensitiveRequest: true,
  ids: { response: ['playerId'] },
  params: { body: 'body' },
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'invalid_grant_key',
    'player_id_does_not_match',
    'provider_not_supported',
    'provider_type_already_exists',
    'provider_owned_by_other',
    'provider_already_connected',
    'ip_blocked',
    'app_not_found',
    'player_not_found',
    'provider_config_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const getBlockStatus = op<void, T.GetBlockStatusResponse>()({
  id: 'getBlockStatus',
  method: 'GET',
  path: '/auth/v1/block',
  credential: 'session',
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'app_not_found',
    'block_type_not_found',
    'block_type_content_not_found',
  ],
  failures: AUTH_FAILURES,
})

export const withdrawPlayer = op<void, T.EmptyResponse>()({
  id: 'withdrawPlayer',
  method: 'DELETE',
  path: '/auth/v1/player',
  credential: 'session',
  outcomes: [
    'app_id_mismatch',
    'invalid_gateway_context',
    'app_not_found',
    'player_not_found',
    'token_revoke_failed',
  ],
  failures: AUTH_FAILURES,
})
