/*
 * Types follow `tcb.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 */

/** Request for `processGatewayRequest`. */
export interface ProcessGatewayRequestRequest {
  readonly body: {
    /** TCB region code where the Cloud Function is deployed. */
    readonly region: string
    /** TCB namespace (Environment ID) that the Cloud Function belongs to. */
    readonly namespace: string
    /** Name of the Cloud Function to run. */
    readonly functionName: string
    /**
     * Parameter for the Cloud Function, as a JSON object serialized to a string.
     * The SDK sends it as is.
     */
    readonly functionParam: string
  }
}

/** Response for `processGatewayRequest`. */
export interface ProcessGatewayRequestResponse {
  /** Identifier of the Cloud Function request. */
  readonly requestId?: string
  /** Result message of the Cloud Function run. */
  readonly resultMsg?: string
}
