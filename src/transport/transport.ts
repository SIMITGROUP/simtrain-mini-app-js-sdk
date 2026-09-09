import type { RequestOptions } from "./request-options";

export interface QueryParameter {
  readonly name: string;
  readonly value: unknown;
  readonly style: "form";
  readonly explode: true;
}

export interface TransportRequest {
  readonly operationId: string;
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly pathParameters?: Readonly<Record<string, unknown>>;
  readonly query?: readonly QueryParameter[];
  readonly body?: unknown;
  readonly requestMediaType?: "application/json";
  readonly successStatuses: readonly (number | "default")[];
  readonly responseMediaType?: "application/json" | "text/plain";
}

export interface SdkTransport {
  request<Response>(
    request: TransportRequest,
    options?: RequestOptions
  ): Promise<Response>;
}

export interface SdkHostControlOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface SdkRuntimeTransport extends SdkTransport {
  openOnScreenForm(
    resource: string,
    id?: string,
    options?: SdkHostControlOptions
  ): Promise<void>;
}
