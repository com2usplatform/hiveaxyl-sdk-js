/* Types follow `token.openapi.yaml`. */

/** Request for `issueToken`. Exchanges an authorization code from a login API (`authorization_code`). */
export interface IssueTokenRequest {
  readonly body: {
    /** Token grant type. Always `authorization_code`. */
    readonly grantType: 'authorization_code'
    /** OAuth client identifier. */
    readonly clientId: string
    /** The `authorizationCode` from the login response. It expires 180 seconds after issue. Sensitive. Do not log or persist. */
    readonly authorizationCode: string
    /** The `verifier` of the PKCE value created for this login. Sensitive. Do not log or persist. */
    readonly codeVerifier: string
  }
}

/** Server response for `issueToken`. The SDK keeps these values in the session and does not return them. */
export interface TokenResponse {
  /** Access token. Sensitive. Do not log or persist. */
  readonly accessToken: string
  /** Refresh token. Sensitive. Do not log or persist. */
  readonly refreshToken: string | null
  /** Remaining lifetime in seconds (RFC 6749 §5.1). */
  readonly expiresIn: number
}

/** What the app receives when `issueToken` succeeds. It holds no tokens. */
export interface IssuedSession {
  /** Player identifier. */
  readonly playerId: string
  /** Access token expiry time in epoch milliseconds. `0` means unknown. */
  readonly expiresAtMs: number
}
