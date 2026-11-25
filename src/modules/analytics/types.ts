/*
 * Types follow `analytics.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 */

/**
 * One entry of `logBody[]`.
 * Only `eventTime` and `eventName` are required.
 * Every other field is a custom attribute that the game defines.
 * Any number of attributes may be added under any name.
 * The server does not interpret their contents.
 * Put the attributes directly on this object.
 * The JSON sent is the same as the Unity SDK's `AdditionalProperties`.
 * To name your event shape, declare it with `type`, not `interface`.
 * An `interface` has no implicit index signature, so TypeScript rejects it here.
 *
 * @example
 * type LevelUpEvent = { eventTime: string; eventName: string; level: number }
 * const event: LevelUpEvent = { eventTime: new Date().toISOString(), eventName: 'level_up', level: 5 }
 * await axyl.analytics.collectClientLog({ body: { logBody: [event] } })
 */
export interface ClientLogEvent {
  /** Time the event occurred. Only RFC 3339 is accepted (e.g. `2026-01-01T07:34:42+09:00`). */
  readonly eventTime: string
  /** Event name (e.g. `hivesdk_levelup_log`). */
  readonly eventName: string
  /** Device identifier. Optional for now. */
  readonly deviceId?: string
  /** User identifier. Optional for now. */
  readonly userId?: string
  /** The server always overwrites this with `hive`. You do not need to send it. */
  readonly identifierProvider?: 'hive'
  /** A custom attribute that the game defines. */
  readonly [property: string]: unknown
}

/** Request for `collectClientLog`. */
export interface CollectClientLogRequest {
  readonly body: {
    /** List of log events. */
    readonly logBody: readonly ClientLogEvent[]
  }
}

/**
 * Response for `collectClientLog`. This intake-only API returns no fields.
 * Check only `kind`. Do not read `data`: the server can send an empty object or `null`.
 */
export type CollectClientLogResponse = Readonly<Record<string, never>>
