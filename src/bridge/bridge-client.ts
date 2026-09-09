import { SimTrainSdkError } from "../errors/sdk-error";
import {
  BRIDGE_PROTOCOL_V2,
  type AuthTokenPayloadV2,
  type BridgeContextV2,
  type HostCapabilityV2,
  type NavigateCurrentPayloadV2,
  type NavigateToPayloadV2,
  type OpenOnScreenFormPayloadV2,
} from "./protocol";
import {
  isBridgeCandidate,
  isLoopbackHostname,
  parseHostMessage,
} from "./validation";

export interface BridgeClientOptions {
  readonly window?: Window;
  readonly timeoutMs?: number;
  readonly handshakeRetryMs?: number;
}

interface Handshake {
  readonly nonce: string;
  readonly promise: Promise<BridgeContextV2>;
  readonly resolve: (context: BridgeContextV2) => void;
  readonly reject: (error: SimTrainSdkError) => void;
  retryTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  readonly expectedType: "AUTH_TOKEN_V2_RESULT" | "CONTROL_RESULT";
  readonly resolve: (payload: AuthTokenPayloadV2 | undefined) => void;
  readonly reject: (error: SimTrainSdkError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
}

const error = (
  code: ConstructorParameters<typeof SimTrainSdkError>[0],
  message: string
): SimTrainSdkError => new SimTrainSdkError(code, message);

function randomIdentifier(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function validHostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && isLoopbackHostname(url.hostname)))
    );
  } catch {
    return false;
  }
}

export class BridgeClient {
  private readonly browserWindow: Window;
  private readonly parentWindow: Window;
  private readonly timeoutMs: number;
  private readonly handshakeRetryMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly invalidationListeners = new Set<() => void>();
  private context: BridgeContextV2 | undefined;
  private handshake: Handshake | undefined;
  private hostOrigin: string | undefined;
  private activeNonce: string | undefined;
  private disposed = false;

  private readonly messageListener: EventListener = event => {
    this.handleMessage(event as MessageEvent);
  };
  private readonly pageHideListener: EventListener = () => {
    this.invalidateContext("Host page context was hidden");
  };
  private readonly pageShowListener: EventListener = event => {
    if ((event as PageTransitionEvent).persisted) {
      this.invalidateContext("Host page context was restored");
    }
  };

  constructor(options: BridgeClientOptions = {}) {
    this.browserWindow = options.window ?? window;
    this.parentWindow = this.browserWindow.parent;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.handshakeRetryMs = options.handshakeRetryMs ?? 250;
    this.browserWindow.addEventListener("message", this.messageListener);
    this.browserWindow.addEventListener("pagehide", this.pageHideListener);
    this.browserWindow.addEventListener("pageshow", this.pageShowListener);
  }

  initialize(signal?: AbortSignal): Promise<BridgeContextV2> {
    if (this.disposed)
      return Promise.reject(error("DISPOSED", "SDK is disposed"));
    if (this.parentWindow === this.browserWindow) {
      return Promise.reject(
        error("NOT_EMBEDDED", "SimTrain SDK must run in SimTrain")
      );
    }
    if (signal?.aborted)
      return Promise.reject(error("ABORTED", "Operation aborted"));
    if (this.context !== undefined) return Promise.resolve(this.context);
    if (this.handshake === undefined) this.startHandshake();
    const handshake = this.handshake;
    if (handshake === undefined) {
      return Promise.reject(
        error("UNSUPPORTED_HOST", "SimTrain host handshake could not start")
      );
    }
    return this.withAbort(handshake.promise, signal);
  }

  getAuthToken(signal?: AbortSignal): Promise<AuthTokenPayloadV2> {
    return this.request(
      "auth.getToken",
      "AUTH_TOKEN_V2",
      {},
      "AUTH_TOKEN_V2_RESULT",
      signal
    ).then(payload => {
      if (payload === undefined) {
        throw error("MALFORMED_BRIDGE_MESSAGE", "Host token response is empty");
      }
      return payload;
    });
  }

  async navigateTo(
    payload: NavigateToPayloadV2,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(
      "ui.navigateTo",
      "UI_NAVIGATE_TO",
      payload,
      "CONTROL_RESULT",
      signal
    );
  }

  async navigateCurrent(
    payload: NavigateCurrentPayloadV2,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(
      "current.navigateTo",
      "CURRENT_NAVIGATE_TO",
      payload,
      "CONTROL_RESULT",
      signal
    );
  }

  async openOnScreenForm(
    payload: OpenOnScreenFormPayloadV2,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(
      "ui.openOnScreenForm",
      "UI_OPEN_ON_SCREEN_FORM",
      payload,
      "CONTROL_RESULT",
      signal
    );
  }

  onContextInvalidated(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateContext("SDK was disposed", "DISPOSED");
    this.browserWindow.removeEventListener("message", this.messageListener);
    this.browserWindow.removeEventListener("pagehide", this.pageHideListener);
    this.browserWindow.removeEventListener("pageshow", this.pageShowListener);
    this.invalidationListeners.clear();
  }

  private startHandshake(): void {
    const nonce = randomIdentifier();
    let resolveHandshake!: (context: BridgeContextV2) => void;
    let rejectHandshake!: (failure: SimTrainSdkError) => void;
    const promise = new Promise<BridgeContextV2>((resolve, reject) => {
      resolveHandshake = resolve;
      rejectHandshake = reject;
    });
    const handshake: Handshake = {
      nonce,
      promise,
      resolve: resolveHandshake,
      reject: rejectHandshake,
    };
    this.handshake = handshake;
    const started = performance.now();
    const sendReady = (): void => {
      if (this.handshake !== handshake) return;
      this.parentWindow.postMessage(
        {
          protocol: BRIDGE_PROTOCOL_V2,
          version: 2,
          type: "READY",
          payload: { nonce },
        },
        "*"
      );
      if (
        performance.now() + this.handshakeRetryMs <
        started + this.timeoutMs
      ) {
        handshake.retryTimer = setTimeout(sendReady, this.handshakeRetryMs);
      }
    };
    sendReady();
    handshake.timeoutTimer = setTimeout(() => {
      if (this.handshake !== handshake) return;
      this.finishHandshake();
      rejectHandshake(
        error("BRIDGE_TIMEOUT", "SimTrain host handshake timed out")
      );
    }, this.timeoutMs);
  }

  private finishHandshake(): void {
    if (this.handshake?.retryTimer !== undefined) {
      clearTimeout(this.handshake.retryTimer);
    }
    if (this.handshake?.timeoutTimer !== undefined) {
      clearTimeout(this.handshake.timeoutTimer);
    }
    this.handshake = undefined;
  }

  private handleMessage(event: MessageEvent): void {
    if (this.disposed || event.source !== this.parentWindow) return;
    if (this.hostOrigin !== undefined && event.origin !== this.hostOrigin)
      return;
    const data: unknown = event.data;
    if (!isBridgeCandidate(data)) return;
    const message = parseHostMessage(data);
    if (message === undefined) {
      const requestId =
        typeof data === "object" &&
        data !== null &&
        "requestId" in data &&
        typeof data.requestId === "string"
          ? data.requestId
          : undefined;
      if (requestId !== undefined) {
        this.rejectPending(
          requestId,
          error("MALFORMED_BRIDGE_MESSAGE", "Malformed SimTrain host response")
        );
      }
      return;
    }
    if (message.type === "INIT") {
      if (
        this.context !== undefined &&
        this.activeNonce === message.payload.nonce &&
        event.origin === this.hostOrigin
      ) {
        this.postAck(message.payload.nonce, event.origin);
        return;
      }
      if (
        !validHostOrigin(event.origin) ||
        this.handshake === undefined ||
        message.payload.nonce !== this.handshake.nonce
      ) {
        return;
      }
      this.hostOrigin = event.origin;
      this.activeNonce = message.payload.nonce;
      this.context = Object.freeze({
        hostOrigin: event.origin,
        gatewayBaseUrl: message.payload.gatewayBaseUrl,
        capabilities: new Set(message.payload.capabilities),
      });
      const handshake = this.handshake;
      this.finishHandshake();
      this.postAck(message.payload.nonce, event.origin);
      handshake.resolve(this.context);
      return;
    }
    if (message.type === "CONTEXT_INVALIDATED") {
      this.invalidateContext("SimTrain host context changed");
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (pending === undefined || pending.expectedType !== message.type) return;
    this.cleanupPending(message.requestId, pending);
    if (!message.payload.success) {
      pending.reject(
        error("HOST_REQUEST_FAILED", message.payload.error.message)
      );
    } else if (message.type === "AUTH_TOKEN_V2_RESULT") {
      pending.resolve({
        token: message.payload.token,
        xOrg: message.payload.xOrg,
        expiresInSeconds: message.payload.expiresInSeconds,
      });
    } else {
      pending.resolve(undefined);
    }
  }

  private async request(
    capability: HostCapabilityV2,
    type:
      | "AUTH_TOKEN_V2"
      | "UI_NAVIGATE_TO"
      | "CURRENT_NAVIGATE_TO"
      | "UI_OPEN_ON_SCREEN_FORM",
    payload: unknown,
    expectedType: PendingRequest["expectedType"],
    signal?: AbortSignal
  ): Promise<AuthTokenPayloadV2 | undefined> {
    const started = performance.now();
    const context = await this.initialize(signal);
    if (!context.capabilities.has(capability)) {
      throw error("UNSUPPORTED_HOST", `SimTrain host lacks ${capability}`);
    }
    if (signal?.aborted) throw error("ABORTED", "Operation aborted");
    const remaining = Math.max(
      1,
      this.timeoutMs - (performance.now() - started)
    );
    const requestId = randomIdentifier();
    const promise = new Promise<AuthTokenPayloadV2 | undefined>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(error("BRIDGE_TIMEOUT", "SimTrain host request timed out"));
        }, remaining);
        const abort = signal
          ? () => {
              const pending = this.pending.get(requestId);
              if (pending !== undefined)
                this.cleanupPending(requestId, pending);
              reject(error("ABORTED", "Operation aborted"));
            }
          : undefined;
        const pending: PendingRequest = {
          expectedType,
          resolve,
          reject,
          timer,
          ...(signal === undefined ? {} : { signal }),
          ...(abort === undefined ? {} : { abort }),
        };
        this.pending.set(requestId, pending);
        signal?.addEventListener("abort", abort as EventListener, {
          once: true,
        });
      }
    );
    this.parentWindow.postMessage(
      {
        protocol: BRIDGE_PROTOCOL_V2,
        version: 2,
        type,
        requestId,
        payload,
      },
      context.hostOrigin
    );
    return promise;
  }

  private cleanupPending(requestId: string, pending: PendingRequest): void {
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (pending.abort !== undefined) {
      pending.signal?.removeEventListener("abort", pending.abort);
    }
  }

  private postAck(nonce: string, origin: string): void {
    this.parentWindow.postMessage(
      {
        protocol: BRIDGE_PROTOCOL_V2,
        version: 2,
        type: "ACK",
        payload: { nonce },
      },
      origin
    );
  }

  private rejectPending(requestId: string, failure: SimTrainSdkError): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.cleanupPending(requestId, pending);
    pending.reject(failure);
  }

  private invalidateContext(
    message: string,
    code: "UNSUPPORTED_HOST" | "DISPOSED" = "UNSUPPORTED_HOST"
  ): void {
    this.context = undefined;
    this.hostOrigin = undefined;
    this.activeNonce = undefined;
    if (this.handshake !== undefined) {
      const handshake = this.handshake;
      this.finishHandshake();
      handshake.reject(error(code, message));
    }
    for (const [requestId, pending] of this.pending) {
      this.cleanupPending(requestId, pending);
      pending.reject(error(code, message));
    }
    for (const listener of this.invalidationListeners) listener();
  }

  private withAbort<Value>(
    promise: Promise<Value>,
    signal?: AbortSignal
  ): Promise<Value> {
    if (signal === undefined) return promise;
    if (signal.aborted)
      return Promise.reject(error("ABORTED", "Operation aborted"));
    return new Promise<Value>((resolve, reject) => {
      const abort = (): void => {
        reject(error("ABORTED", "Operation aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(
        value => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (failure: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(
            failure instanceof Error
              ? failure
              : error("UNSUPPORTED_HOST", "SimTrain host operation failed")
          );
        }
      );
    });
  }
}
