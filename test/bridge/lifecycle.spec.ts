/** @jest-environment jsdom */

import { BridgeClient } from "../../src/bridge/bridge-client";

describe("BridgeClient lifecycle", () => {
  it("times out a lost handshake and cleans up idempotently", async () => {
    jest.useFakeTimers();
    const parent = { postMessage: jest.fn() };
    const listeners = new Map<string, EventListener>();
    const fake = {
      parent,
      addEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Window;
    const client = new BridgeClient({
      window: fake,
      timeoutMs: 1_000,
      handshakeRetryMs: 100,
    });
    const pending = client.initialize();
    const timedOut = expect(pending).rejects.toMatchObject({
      code: "BRIDGE_TIMEOUT",
    });
    await jest.advanceTimersByTimeAsync(1_001);

    await timedOut;
    expect(parent.postMessage).toHaveBeenCalledTimes(10);
    client.dispose();
    client.dispose();
    expect(listeners.size).toBe(0);
    jest.useRealTimers();
  });
});
