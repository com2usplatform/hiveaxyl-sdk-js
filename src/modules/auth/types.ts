import type { OpenEnum } from '../../core/operation'

/*
 * Types follow `auth.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 * Player IDs are int64 values sent as strings.
 * A string keeps the exact value even above `Number.MAX_SAFE_INTEGER`.
 */

/** Provider identifier. */
export type ProviderId =
  | 'GUEST'
  | 'GOOGLE'
  | 'SIGNIN_APPLE'
  | 'GOOGLE_PLAY_GAMES'
  | 'STEAM'
  | 'X'
  | 'USERNAME'
  | 'CUSTOM_PROVIDER'

/** PKCE values that every login API takes. Create them with `newPkce()` for each login. */
export interface PkceParams {
  /** PKCE `client_id`, issued per project in the Hive Axyl console. */
  readonly clientId: string
  /** PKCE code challenge. Use `challenge` from `newPkce()`. */
  readonly codeChallenge: string
  /** PKCE code challenge method. Always `S256`. */
  readonly codeChallengeMethod: 'S256'
}

/** A provider linked to the player. */
export interface LinkedProvider {
  /** User identifier at the linked provider. */
  readonly providerUserId: string
  /** Provider identifier. */
  readonly providerId: OpenEnum<ProviderId>
  /** Numeric provider identifier. */
  readonly providerIndex: number
}

/**
 * Response of a login API.
 * Exchange `authorizationCode` with `token.issueToken` within 180 seconds.
 */
export interface LoginResponse {
  /** Player identifier. */
  readonly playerId: string
  /** Time the player was first created, as ISO 8601 UTC. */
  readonly createdAt: string
  /** Authorization code to exchange for tokens. It expires in 180 seconds. Sensitive. Do not log or persist. */
  readonly authorizationCode: string
  /**
   * Linked provider accounts.
   * `GUEST` appears only for a pure guest with no other provider.
   */
  readonly providerList: readonly LinkedProvider[]
  /**
   * Whether the player has a usage restriction.
   * Login still succeeds when it is `true`. Use it as a signal to show the restriction notice.
   * Call `getBlockStatus` for the reason and the period.
   */
  readonly isBlock: boolean
}

/** Request for `createGuest`. */
export interface CreateGuestRequest {
  readonly body: PkceParams & {
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
    /**
     * Pre-authorization key that the app server received. It lasts 60 seconds and works once.
     * It is required when the console turns on the grant key setting.
     * Sensitive. Do not log or persist.
     */
    readonly grantKey?: string
  }
}

/** Response for `createGuest`. */
export interface CreateGuestResponse {
  /** Player identifier of the new guest. */
  readonly playerId: string
  /** Creation time, as ISO 8601 UTC. */
  readonly createdAt: string
  /** Authorization code to exchange for tokens. It expires in 180 seconds. Sensitive. Do not log or persist. */
  readonly authorizationCode: string
  /** Credential for guest login. It stays valid until the player links a first sign-in provider. Sensitive. Do not log it. Keep it in memory or `sessionStorage`, nowhere else. */
  readonly guestToken: string
}

/** Request for `loginGuest`. */
export interface LoginGuestRequest {
  readonly body: PkceParams & {
    /** The `playerId` issued when the guest was created. */
    readonly guestPlayerId: string
    /** The `guestToken` issued when the guest was created. Sensitive. Do not log it. Keep it in memory or `sessionStorage`, nowhere else. */
    readonly guestToken: string
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
  }
}

/** Response for `getProviderList`. */
export interface GetProviderListResponse {
  /** Providers available under the app and country conditions. */
  readonly providerList: readonly { providerIndex: number; providerId: OpenEnum<ProviderId> }[]
}

/** Request for `exchangeProviderToken`. */
export interface ExchangeProviderTokenRequest {
  readonly body: {
    /** Provider that supports code exchange: `GOOGLE`, `SIGNIN_APPLE`, `GOOGLE_PLAY_GAMES`, or `X`. */
    readonly providerId: ProviderId
    /** Authorization code issued by the provider. Sensitive. Do not log or persist. */
    readonly providerCode: string
    /**
     * Redirect URI used in the authorize request, character for character.
     * Required for `GOOGLE`, `GOOGLE_PLAY_GAMES`, and `X`.
     * For `SIGNIN_APPLE`, it is required only in the web OAuth flow.
     */
    readonly redirectUri?: string
    /** PKCE code verifier. Required for `X`. For `GOOGLE`, send it only when the authorize request used PKCE. Sensitive. Do not log or persist. */
    readonly codeVerifier?: string
  }
}

/** Response for `exchangeProviderToken`. `providerToken` is a credential. */
export interface ExchangeProviderTokenResponse {
  /** User identifier at the provider. */
  readonly providerUserId: string
  /** Provider token. An `id_token` for `SIGNIN_APPLE` and `GOOGLE`. An `access_token` for `GOOGLE_PLAY_GAMES` and `X`. Sensitive. Do not log or persist. */
  readonly providerToken: string
  /** Provider identifier. */
  readonly providerId: OpenEnum<ProviderId>
}

/** Request for `loginProvider`. */
export interface LoginProviderRequest {
  readonly body: PkceParams & {
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
    /** Provider to log in with. `GUEST` and `USERNAME` are not allowed. */
    readonly providerId: ProviderId
    /** User identifier at the provider. For `STEAM`, the SteamID64. */
    readonly providerUserId: string
    /**
     * Provider token or authentication result to verify. It differs per provider.
     * `GOOGLE` and `SIGNIN_APPLE` take an `id_token`.
     * `GOOGLE_PLAY_GAMES` and `X` take an `access_token`.
     * Sensitive. Do not log or persist.
     */
    readonly providerToken: string
  }
}

/** Request for `linkProvider`. */
export interface LinkProviderRequest {
  readonly body: {
    /** Provider to link. `GUEST` is not allowed. */
    readonly providerId: ProviderId
    /**
     * User identifier at the provider.
     * For `USERNAME`, the username. An existing username is linked. A new one creates an account.
     */
    readonly providerUserId: string
    /**
     * Provider token.
     * For `USERNAME`, pass the raw password. The SDK sends its SHA-256 hex.
     * Sensitive. Do not log or persist.
     */
    readonly providerToken: string
  }
}

/** Response for `linkProvider` and `linkCustomProvider`. */
export interface LinkProviderResponse {
  /** Player identifier. */
  readonly playerId: string
  /** User identifier at the linked provider. */
  readonly providerUserId: string
  /** Numeric provider identifier. */
  readonly providerIndex: number
  /** Provider identifier. */
  readonly providerId: OpenEnum<ProviderId>
}

/** Request for `unlinkProvider`. */
export interface UnlinkProviderRequest {
  readonly body: {
    /** Provider to unlink. `GUEST` cannot be unlinked. */
    readonly providerId: ProviderId
  }
}

/** Request for `loginWithAccessToken`. Pass the access token as `options.accessToken`. */
export interface LoginWithAccessTokenRequest {
  readonly body: PkceParams
}

/** Request for `createUsername`. */
export interface CreateUsernameRequest {
  readonly body: PkceParams & {
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
    /** Username. */
    readonly username: string
    /** Raw password. The SDK sends its SHA-256 hex. Hashing it yourself hashes it twice. Sensitive. Do not log or persist. */
    readonly password: string
    /**
     * Pre-authorization key that the app server received. It lasts 60 seconds and works once.
     * It is required when the console turns on the grant key setting.
     * Sensitive. Do not log or persist.
     */
    readonly grantKey?: string
  }
}

/** Response for `createUsername`. */
export interface CreateUsernameResponse {
  /** Player identifier of the new account. */
  readonly playerId: string
  /** Creation time, as ISO 8601 UTC. */
  readonly createdAt: string
  /** Authorization code to exchange for tokens. It expires in 180 seconds. Sensitive. Do not log or persist. */
  readonly authorizationCode: string
}

/** Request for `loginUsername`. */
export interface LoginUsernameRequest {
  readonly body: PkceParams & {
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
    /** Username. */
    readonly username: string
    /** Raw password. The SDK sends its SHA-256 hex. Hashing it yourself hashes it twice. Sensitive. Do not log or persist. */
    readonly password: string
  }
}

/** Request for `changeUsernamePassword`. */
export interface ChangeUsernamePasswordRequest {
  /** Both values are raw passwords. The SDK sends their SHA-256 hex. The new password must differ. Sensitive. Do not log or persist. */
  readonly body: { readonly currentPassword: string; readonly newPassword: string }
}

/** Request for `loginCustomProvider`. */
export interface LoginCustomProviderRequest {
  readonly body: PkceParams & {
    /** Device identifier. Use `deviceKey()`. */
    readonly deviceKey: string
    /** Pre-authorization key that the app server issued for custom login. It lasts 60 seconds and works once. Sensitive. Do not log or persist. */
    readonly grantKey: string
  }
}

/** Request for `linkCustomProvider`. */
export interface LinkCustomProviderRequest {
  readonly body: {
    /** Pre-authorization key that the app server issued for custom linking. It lasts 60 seconds and works once. Sensitive. Do not log or persist. */
    readonly grantKey: string
  }
}

/** Response for `getBlockStatus`. */
export interface GetBlockStatusResponse {
  /** Whether the player has a usage restriction now. */
  readonly isBlocked: boolean
  /** Restriction details. `null` when there is no restriction. */
  readonly block: {
    /** Restriction type code registered in the Hive Axyl console (100 to 999). */
    readonly code: number
    /** Localized restriction type name. */
    readonly name: string
    /** Localized message for the player. */
    readonly message: string
    /** Restriction start time, as ISO 8601 UTC. */
    readonly startAt: string
    /** Restriction end time, as ISO 8601 UTC. `null` for a permanent restriction. */
    readonly endAt: string | null
  } | null
}

/** A response without content (`data: null`). */
export type EmptyResponse = null
