import { SimTrainSdkError } from "./sdk-error";

export interface SimTrainApiErrorDetail {
  readonly field?: string;
  readonly message: string;
}

export interface SimTrainRateLimitInfo {
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function bounded(value: unknown, maximum = 2_048): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export class SimTrainApiError extends SimTrainSdkError {
  readonly status: number;
  readonly apiCode: string;
  readonly details: readonly SimTrainApiErrorDetail[];
  readonly requestId: string | undefined;
  readonly retryAfter: string | undefined;
  readonly rateLimit: SimTrainRateLimitInfo | undefined;

  private constructor(options: {
    status: number;
    apiCode: string;
    message: string;
    details: readonly SimTrainApiErrorDetail[];
    requestId: string | undefined;
    retryAfter: string | undefined;
    rateLimit: SimTrainRateLimitInfo | undefined;
  }) {
    super("API_ERROR", options.message);
    this.name = "SimTrainApiError";
    this.status = options.status;
    this.apiCode = options.apiCode;
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.rateLimit = options.rateLimit;
  }

  static async fromResponse(response: Response): Promise<SimTrainApiError> {
    let payload: unknown;
    try {
      const text = await response.text();
      payload = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      payload = undefined;
    }
    const envelope = record(payload);
    const body = record(envelope?.error);
    const apiCode =
      bounded(body?.code, 128) ?? `HTTP_${String(response.status)}`;
    const message =
      bounded(body?.message) ??
      `SimTrain API request failed with HTTP ${String(response.status)}`;
    const rawDetails = Array.isArray(body?.details)
      ? body.details.slice(0, 100)
      : [];
    const details = rawDetails.flatMap(item => {
      const detail = record(item);
      const detailMessage = bounded(detail?.message);
      if (detailMessage === undefined) return [];
      const field = bounded(detail?.field, 256);
      return [
        Object.freeze({
          ...(field === undefined ? {} : { field }),
          message: detailMessage,
        }),
      ];
    });
    const limit = headerNumber(response.headers, "x-ratelimit-limit");
    const remaining = headerNumber(response.headers, "x-ratelimit-remaining");
    const reset = headerNumber(response.headers, "x-ratelimit-reset");
    const rateLimit =
      limit === undefined && remaining === undefined && reset === undefined
        ? undefined
        : Object.freeze({
            ...(limit === undefined ? {} : { limit }),
            ...(remaining === undefined ? {} : { remaining }),
            ...(reset === undefined ? {} : { reset }),
          });
    return new SimTrainApiError({
      status: response.status,
      apiCode,
      message,
      details: Object.freeze(details),
      requestId: bounded(response.headers.get("x-request-id"), 128),
      retryAfter: bounded(response.headers.get("retry-after"), 128),
      rateLimit,
    });
  }
}
