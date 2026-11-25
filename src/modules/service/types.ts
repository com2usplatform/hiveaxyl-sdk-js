/*
 * Types follow `service.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 */

/**
 * Time zone used for `startAt` and `endAt`.
 * The server resolves it from the client's country and falls back to UTC.
 * With the UTC fallback, `isInEuropeanUnion` is `false`, `name` is `null`, and `names` is empty.
 */
export interface ServiceTimezone {
  /** IANA time zone identifier. */
  readonly id: string
  /** UTC offset in `±HH:MM` format, including daylight saving time. A zero offset is `+00:00`. */
  readonly utcOffset: string
  /** UTC offset in seconds, at the same reference time as `utcOffset`. */
  readonly offsetSeconds: number
  /** Whether daylight saving time is in effect at the reference time of `utcOffset`. */
  readonly dst: boolean
  /** Whether the resolved country is in the European Union. */
  readonly isInEuropeanUnion: boolean
  /** Country name in the language from `Accept-Language`. `null` when no name is available. */
  readonly name: string | null
  /** Country names keyed by language tag. Only available names are included. */
  readonly names: Readonly<Record<string, string>>
}

/** Fields shared by maintenance, update, and country block notices. */
interface Notice {
  /** Start time. `null` when no policy applies or the policy has no start time. */
  readonly startAt: string | null
  /** End time. `null` when no policy applies or the policy is open-ended. */
  readonly endAt: string | null
  /** Whether the policy is always on instead of bounded by time. */
  readonly alwaysOn: boolean
  /** Notice title in the negotiated language. An empty string when there is no title. */
  readonly title: string
  /** Notice body, in the same language as `title`. */
  readonly content: string
  /** Redirect URL. An empty string when not configured. */
  readonly redirectUrl: string
  /**
   * Time zone of `startAt` and `endAt`.
   * `null` when no update or block applies.
   * Maintenance entries always have one.
   */
  readonly timezone: ServiceTimezone | null
}

/** Request for `getActiveMaintenances`. Every field is optional. */
export interface GetActiveMaintenancesRequest {
  /** Server code to filter by. Omit it to skip the server filter. */
  readonly serverCode?: string
  /**
   * Client version, matched exactly together with the app ID.
   * Omitting it excludes maintenance that targets specific versions.
   */
  readonly clientVersion?: string
  /** Player ID to check against the allowlist. */
  readonly playerId?: string
}

/** An active server maintenance entry. */
export interface Maintenance extends Notice {
  /** Time zone of `startAt` and `endAt`. */
  readonly timezone: ServiceTimezone
  /** Maintenance policy ID. */
  readonly id: string
  /** Server codes that this maintenance targets. */
  readonly servers: readonly string[]
  /** Version targets of this maintenance for the requesting app. Empty when there are none. */
  readonly versions: readonly { appId: string; clientVersion: string }[]
}

/** Response for `getActiveMaintenances`. The newest policy comes first. */
export type GetActiveMaintenancesResponse = readonly Maintenance[]

/** Request for `checkClientUpdate`. */
export interface CheckClientUpdateRequest {
  /** Current client version. It must not be empty or contain whitespace. */
  readonly clientVersion: string
  /** Player ID to check against the allowlist. */
  readonly playerId?: string
}

/** Response for `checkClientUpdate`. */
export interface CheckClientUpdateResponse extends Notice {
  /** Update policy ID. `null` when no update policy applies. */
  readonly id: string | null
  /** Whether an active update policy applies to the client. */
  readonly updateRequired: boolean
  /** Whether the update is mandatory. `false` means it is recommended. */
  readonly forceUpdate: boolean
  /** Version targets of the applied policy for the requesting app. Empty when no policy applies. */
  readonly versions: readonly { appId: string; clientVersion: string }[]
}

/** Request for `checkCountryBlock`. */
export interface CheckCountryBlockRequest {
  /** Country to check, as ISO 3166-1 alpha-2. It is case-insensitive. */
  readonly countryCode: string
  /** Player ID to check against the allowlist. */
  readonly playerId?: string
}

/** Response for `checkCountryBlock`. */
export interface CheckCountryBlockResponse extends Notice {
  /** Block policy ID. `null` when the country is not blocked. */
  readonly id: string | null
  /** Whether the country is blocked. */
  readonly blocked: boolean
  /** Countries of the applied policy for the requesting app. Empty when no policy applies. */
  readonly countries: readonly { appId: string; countryCode: string }[]
}
