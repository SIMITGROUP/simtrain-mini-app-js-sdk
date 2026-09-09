export type SimTrainSdkErrorCode =
  | "NOT_EMBEDDED"
  | "BRIDGE_TIMEOUT"
  | "UNSUPPORTED_HOST"
  | "MALFORMED_BRIDGE_MESSAGE"
  | "DISPOSED"
  | "ABORTED"
  | "HTTP_TIMEOUT"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE"
  | "API_ERROR"
  | "HOST_REQUEST_FAILED";

export class SimTrainSdkError extends Error {
  readonly code: SimTrainSdkErrorCode;

  constructor(code: SimTrainSdkErrorCode, message: string) {
    super(message);
    this.name = "SimTrainSdkError";
    this.code = code;
  }
}
