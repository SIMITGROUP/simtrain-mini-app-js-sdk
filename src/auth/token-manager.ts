import type { AuthTokenPayloadV2 } from "../bridge/protocol";
import { SimTrainSdkError } from "../errors/sdk-error";
import type { AuthContextSnapshot } from "./auth-context";

export interface AuthTokenProvider {
  getAuthToken(signal?: AbortSignal): Promise<AuthTokenPayloadV2>;
  onContextInvalidated(listener: () => void): () => void;
}

export interface TokenManagerOptions {
  readonly now?: () => number;
  readonly refreshMarginMs?: number;
}

export interface GetAuthContextOptions {
  readonly forceRefresh?: boolean;
  readonly signal?: AbortSignal | undefined;
}

interface Refresh {
  readonly generation: number;
  readonly controller: AbortController;
  readonly promise: Promise<AuthContextSnapshot>;
}

function aborted(): SimTrainSdkError {
  return new SimTrainSdkError("ABORTED", "Authentication operation aborted");
}

function disposed(): SimTrainSdkError {
  return new SimTrainSdkError("DISPOSED", "SDK is disposed");
}

export class TokenManager {
  private readonly now: () => number;
  private readonly refreshMarginMs: number;
  private readonly unsubscribeInvalidation: () => void;
  private snapshot: AuthContextSnapshot | undefined;
  private refresh: Refresh | undefined;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly provider: AuthTokenProvider,
    options: TokenManagerOptions = {}
  ) {
    this.now = options.now ?? (() => performance.now());
    this.refreshMarginMs = options.refreshMarginMs ?? 30_000;
    this.unsubscribeInvalidation = provider.onContextInvalidated(() => {
      this.invalidate();
    });
  }

  getContext(
    options: GetAuthContextOptions = {}
  ): Promise<AuthContextSnapshot> {
    if (this.disposed) {
      return Promise.reject(disposed());
    }
    if (options.signal?.aborted) return Promise.reject(aborted());
    if (
      options.forceRefresh !== true &&
      this.snapshot !== undefined &&
      this.snapshot.expiresAtMonotonicMs - this.now() > this.refreshMarginMs
    ) {
      return Promise.resolve(this.snapshot);
    }
    if (this.refresh === undefined) this.startRefresh();
    const refresh = this.refresh;
    if (refresh === undefined) {
      return Promise.reject(
        new SimTrainSdkError(
          "UNSUPPORTED_HOST",
          "Token refresh could not start"
        )
      );
    }
    return this.withCallerAbort(refresh.promise, options.signal);
  }

  peek(): AuthContextSnapshot | undefined {
    return this.snapshot;
  }

  invalidate(expectedGeneration?: number): boolean {
    if (
      expectedGeneration !== undefined &&
      this.snapshot?.generation !== expectedGeneration
    ) {
      return false;
    }
    this.snapshot = undefined;
    this.generation += 1;
    this.refresh?.controller.abort();
    this.refresh = undefined;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeInvalidation();
    this.snapshot = undefined;
    this.generation += 1;
    this.refresh?.controller.abort();
    this.refresh = undefined;
  }

  private startRefresh(): void {
    const generation = this.generation;
    const controller = new AbortController();
    const promise = this.provider
      .getAuthToken(controller.signal)
      .then(payload => {
        if (this.disposed) throw disposed();
        if (controller.signal.aborted || generation !== this.generation) {
          throw aborted();
        }
        this.validatePayload(payload);
        const snapshot: AuthContextSnapshot = Object.freeze({
          token: payload.token,
          expiresAtMonotonicMs: this.now() + payload.expiresInSeconds * 1_000,
          generation,
        });
        this.snapshot = snapshot;
        return snapshot;
      })
      .catch((failure: unknown) => {
        if (this.disposed) throw disposed();
        if (controller.signal.aborted || generation !== this.generation) {
          throw aborted();
        }
        throw failure;
      })
      .finally(() => {
        if (this.refresh?.generation === generation) this.refresh = undefined;
      });
    this.refresh = { generation, controller, promise };
  }

  private validatePayload(payload: AuthTokenPayloadV2): void {
    if (
      typeof payload.token !== "string" ||
      payload.token.length === 0 ||
      payload.token.length > 16_384 ||
      typeof payload.xOrg !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payload.xOrg) ||
      !Number.isInteger(payload.expiresInSeconds) ||
      payload.expiresInSeconds < 1 ||
      payload.expiresInSeconds > 3_600
    ) {
      throw new SimTrainSdkError(
        "MALFORMED_BRIDGE_MESSAGE",
        "Host returned an invalid authentication context"
      );
    }
  }

  private withCallerAbort(
    promise: Promise<AuthContextSnapshot>,
    signal?: AbortSignal
  ): Promise<AuthContextSnapshot> {
    if (signal === undefined) return promise;
    return new Promise<AuthContextSnapshot>((resolve, reject) => {
      const onAbort = (): void => {
        reject(aborted());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then(
        value => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (failure: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(
            failure instanceof Error
              ? failure
              : new SimTrainSdkError("UNSUPPORTED_HOST", "Token refresh failed")
          );
        }
      );
    });
  }
}
