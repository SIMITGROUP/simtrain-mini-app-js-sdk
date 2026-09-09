/** @jest-environment jsdom */

import type { AuthTokenPayloadV2 } from "../../src/bridge/protocol";
import { TokenManager } from "../../src/auth/token-manager";

class Provider {
  calls = 0;
  response: AuthTokenPayloadV2 = {
    token: "token-1",
    xOrg: "org:branch",
    expiresInSeconds: 300,
  };
  pending?: Promise<AuthTokenPayloadV2>;
  private listener: (() => void) | undefined;

  getAuthToken(signal?: AbortSignal): Promise<AuthTokenPayloadV2> {
    this.calls += 1;
    if (this.pending !== undefined) return this.pending;
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    return Promise.resolve(this.response);
  }

  onContextInvalidated(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  invalidate(): void {
    this.listener?.();
  }
}

describe("TokenManager", () => {
  it("installs one frozen monotonic snapshot and reuses it outside the margin", async () => {
    let now = 1_000;
    const provider = new Provider();
    const manager = new TokenManager(provider, { now: () => now });

    const first = await manager.getContext();
    now += 269_999;
    const second = await manager.getContext();

    expect(first).toBe(second);
    expect(first).toEqual({
      token: "token-1",
      expiresAtMonotonicMs: 301_000,
      generation: 0,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(provider.calls).toBe(1);
    manager.dispose();
  });

  it("refreshes at the 30-second margin and supports forced refresh", async () => {
    let now = 0;
    const provider = new Provider();
    const manager = new TokenManager(provider, { now: () => now });
    await manager.getContext();
    provider.response = {
      token: "token-2",
      xOrg: "org:branch",
      expiresInSeconds: 300,
    };
    now = 270_000;

    expect((await manager.getContext()).token).toBe("token-2");
    provider.response = { ...provider.response, token: "token-3" };
    expect((await manager.getContext({ forceRefresh: true })).token).toBe(
      "token-3"
    );
    expect(provider.calls).toBe(3);
    manager.dispose();
  });

  it("coalesces concurrent refresh and stores only token lifecycle state", async () => {
    const provider = new Provider();
    let resolve!: (value: AuthTokenPayloadV2) => void;
    provider.pending = new Promise<AuthTokenPayloadV2>(done => {
      resolve = done;
    });
    const manager = new TokenManager(provider);

    const first = manager.getContext();
    const second = manager.getContext();
    resolve({ token: "atomic", xOrg: "new:branch", expiresInSeconds: 120 });

    await expect(first).resolves.toBe(await second);
    expect(provider.calls).toBe(1);
    expect(manager.peek()).toMatchObject({
      token: "atomic",
    });
    expect(typeof manager.peek()?.expiresAtMonotonicMs).toBe("number");
    expect(manager.peek()).not.toHaveProperty("xOrg");
    manager.dispose();
  });

  it("invalidates by exact generation and reacts to host context changes", async () => {
    const provider = new Provider();
    const manager = new TokenManager(provider);
    const first = await manager.getContext();

    expect(manager.invalidate(first.generation + 1)).toBe(false);
    expect(manager.peek()).toBe(first);
    expect(manager.invalidate(first.generation)).toBe(true);
    expect(manager.peek()).toBeUndefined();
    await manager.getContext();
    provider.invalidate();
    expect(manager.peek()).toBeUndefined();
    manager.dispose();
  });

  it("keeps instances isolated and never writes browser storage", async () => {
    const local = jest.spyOn(Storage.prototype, "setItem");
    const firstProvider = new Provider();
    const secondProvider = new Provider();
    secondProvider.response = {
      token: "other",
      xOrg: "another:branch",
      expiresInSeconds: 300,
    };
    const first = new TokenManager(firstProvider);
    const second = new TokenManager(secondProvider);

    expect((await first.getContext()).token).toBe("token-1");
    expect((await second.getContext()).token).toBe("other");
    expect(local).not.toHaveBeenCalled();
    first.dispose();
    second.dispose();
    local.mockRestore();
  });

  it("fails after disposal", async () => {
    const manager = new TokenManager(new Provider());
    manager.dispose();
    await expect(manager.getContext()).rejects.toMatchObject({
      code: "DISPOSED",
    });
  });

  it("reports disposal, not caller abort, for an in-flight token request", async () => {
    const provider = {
      getAuthToken: jest.fn(
        (signal?: AbortSignal) =>
          new Promise<AuthTokenPayloadV2>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new Error("provider aborted"));
            });
          })
      ),
      onContextInvalidated: jest.fn(() => () => undefined),
    };
    const manager = new TokenManager(provider);

    const pending = manager.getContext();
    manager.dispose();

    await expect(pending).rejects.toMatchObject({ code: "DISPOSED" });
  });
});
