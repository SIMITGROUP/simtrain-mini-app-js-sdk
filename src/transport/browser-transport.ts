import type { AuthContextSnapshot } from "../auth/auth-context";
import { SimTrainApiError } from "../errors/api-error";
import { SimTrainSdkError } from "../errors/sdk-error";
import type {
  BridgeContextV2,
  OpenOnScreenFormPayloadV2,
} from "../bridge/protocol";
import { interpolatePath, serializeQuery } from "./query-serializer";
import type { RequestOptions } from "./request-options";
import type {
  SdkHostControlOptions,
  SdkRuntimeTransport,
  TransportRequest,
} from "./transport";

export interface TransportBridge {
  initialize(signal?: AbortSignal): Promise<BridgeContextV2>;
  onContextInvalidated(listener: () => void): () => void;
  openOnScreenForm(
    payload: OpenOnScreenFormPayloadV2,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface TransportTokenManager {
  getContext(options?: {
    readonly forceRefresh?: boolean;
    readonly signal?: AbortSignal | undefined;
  }): Promise<AuthContextSnapshot>;
  invalidate(expectedGeneration?: number): boolean;
}

export type FetchImplementation = (
  input: string,
  init: RequestInit
) => Promise<Response>;

function sdkError(
  code: ConstructorParameters<typeof SimTrainSdkError>[0],
  message: string
): SimTrainSdkError {
  return new SimTrainSdkError(code, message);
}

function validateOptions(options: RequestOptions): number {
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new TypeError("timeoutMs must be an integer between 1 and 120000");
  }
  if (
    options.requestId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.requestId)
  ) {
    throw new TypeError("requestId is invalid");
  }
  return timeout;
}

function buildUrl(context: BridgeContextV2, request: TransportRequest): string {
  const base = new URL(`${context.gatewayBaseUrl.replace(/\/+$/, "")}/`);
  const path = interpolatePath(request.path, request.pathParameters);
  const url = new URL(path.replace(/^\//, ""), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw sdkError(
      "MALFORMED_RESPONSE",
      "Gateway request escaped its configured origin"
    );
  }
  const query = serializeQuery(request.query);
  if (query) url.search = query;
  return url.toString();
}

export class BrowserTransport implements SdkRuntimeTransport {
  private readonly activeControllers = new Set<AbortController>();
  private readonly unsubscribeInvalidation: () => void;
  private disposed = false;

  constructor(
    private readonly bridge: TransportBridge,
    private readonly tokenManager: TransportTokenManager,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis
    )
  ) {
    this.unsubscribeInvalidation = bridge.onContextInvalidated(() => {
      for (const controller of this.activeControllers) controller.abort();
    });
  }

  async request<ResponseType>(
    request: TransportRequest,
    options: RequestOptions = {}
  ): Promise<ResponseType> {
    if (this.disposed) throw sdkError("DISPOSED", "SDK is disposed");
    if (options.signal?.aborted) throw sdkError("ABORTED", "Operation aborted");
    const timeoutMs = validateOptions(options);
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutReason = Symbol("simtrain-http-timeout");
    const timeout = setTimeout(() => {
      controller.abort(timeoutReason);
    }, timeoutMs);
    const abort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const bridgeContext = await this.bridge.initialize(controller.signal);
        const auth = await this.tokenManager.getContext({
          signal: controller.signal,
        });
        const response = await this.performFetch(
          request,
          options,
          bridgeContext,
          auth,
          controller
        );
        if (response.status === 401 && attempt === 0) {
          this.tokenManager.invalidate(auth.generation);
          continue;
        }
        if (!request.successStatuses.includes(response.status)) {
          throw await SimTrainApiError.fromResponse(response);
        }
        return await this.parseSuccess<ResponseType>(response, request);
      }
      throw sdkError(
        "MALFORMED_RESPONSE",
        "Authentication retry did not complete"
      );
    } catch (failure) {
      if (this.isDisposed()) throw sdkError("DISPOSED", "SDK is disposed");
      if (failure instanceof SimTrainSdkError) throw failure;
      if (controller.signal.aborted) {
        if (controller.signal.reason === timeoutReason)
          throw sdkError("HTTP_TIMEOUT", "Gateway request timed out");
        throw sdkError("ABORTED", "Operation aborted");
      }
      throw sdkError("NETWORK_ERROR", "Gateway request failed");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      this.activeControllers.delete(controller);
    }
  }

  openOnScreenForm(
    resource: string,
    id?: string,
    options: SdkHostControlOptions = {}
  ): Promise<void> {
    return this.bridge.openOnScreenForm(
      { resource, ...(id === undefined ? {} : { id }) },
      options.signal
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeInvalidation();
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private async performFetch(
    request: TransportRequest,
    options: RequestOptions,
    bridgeContext: BridgeContextV2,
    auth: AuthContextSnapshot,
    controller: AbortController
  ): Promise<Response> {
    const headers = new Headers({
      accept: request.responseMediaType ?? "application/json",
      authorization: `Bearer ${auth.token}`,
    });
    if (options.requestId !== undefined) {
      headers.set("x-request-id", options.requestId);
    }
    let body: string | undefined;
    if (request.body !== undefined) {
      if (request.requestMediaType !== "application/json") {
        throw sdkError("MALFORMED_RESPONSE", "Unsupported request media type");
      }
      try {
        body = JSON.stringify(request.body);
      } catch {
        throw sdkError(
          "MALFORMED_RESPONSE",
          "Request body is not JSON-serializable"
        );
      }
      headers.set("content-type", "application/json");
    }
    return this.fetchImplementation(buildUrl(bridgeContext, request), {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
  }

  private async parseSuccess<ResponseType>(
    response: Response,
    request: TransportRequest
  ): Promise<ResponseType> {
    if (request.responseMediaType === undefined) {
      const text = await response.text();
      if (text)
        throw sdkError("MALFORMED_RESPONSE", "Expected an empty response");
      return undefined as ResponseType;
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim();
    if (contentType !== request.responseMediaType) {
      throw sdkError(
        "MALFORMED_RESPONSE",
        `Expected ${request.responseMediaType} response`
      );
    }
    if (request.responseMediaType === "text/plain") {
      return (await response.text()) as ResponseType;
    }
    try {
      const text = await response.text();
      if (!text) throw new Error("empty JSON");
      return JSON.parse(text) as ResponseType;
    } catch {
      throw sdkError("MALFORMED_RESPONSE", "Gateway returned malformed JSON");
    }
  }
}
