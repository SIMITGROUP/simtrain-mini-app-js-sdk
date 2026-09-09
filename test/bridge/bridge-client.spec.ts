/** @jest-environment jsdom */

import { BridgeClient } from "../../src/bridge/bridge-client";
import { SimTrainSdkError } from "../../src/errors/sdk-error";
import { BRIDGE_PROTOCOL_V2 } from "../../src/bridge/protocol";

class FakeWindow {
  readonly posted: Array<{ message: unknown; targetOrigin: string }> = [];
  readonly parent = {
    postMessage: (message: unknown, targetOrigin: string): void => {
      this.posted.push({ message, targetOrigin });
    },
  };
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchMessage(data: unknown, origin = "https://app.simtrain.test"): void {
    const event = { data, origin, source: this.parent } as unknown as Event;
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }

  dispatch(type: string, event: Event = {} as Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function envelope(
  type: string,
  payload: unknown,
  requestId?: string
): Readonly<Record<string, unknown>> {
  return {
    protocol: BRIDGE_PROTOCOL_V2,
    version: 2,
    type,
    ...(requestId === undefined ? {} : { requestId }),
    payload,
  };
}

async function initialized(): Promise<{
  client: BridgeClient;
  fake: FakeWindow;
}> {
  const fake = new FakeWindow();
  const client = new BridgeClient({ window: fake as unknown as Window });
  const pending = client.initialize();
  const ready = fake.posted[0]?.message as { payload: { nonce: string } };
  fake.dispatchMessage(
    envelope("INIT", {
      nonce: ready.payload.nonce,
      gatewayBaseUrl: "https://gateway.simtrain.test",
      capabilities: [
        "auth.getToken",
        "ui.navigateTo",
        "current.navigateTo",
        "ui.openOnScreenForm",
      ],
    })
  );
  await pending;
  return { client, fake };
}

describe("BridgeClient", () => {
  it("rejects outside an iframe", async () => {
    const client = new BridgeClient({ window });
    await expect(client.initialize()).rejects.toMatchObject({
      code: "NOT_EMBEDDED",
      message: "SimTrain SDK must run in SimTrain",
    });
    client.dispose();
  });

  it("uses wildcard only for READY, validates nonce/source, then pins origin", async () => {
    const fake = new FakeWindow();
    const client = new BridgeClient({ window: fake as unknown as Window });
    const pending = client.initialize();
    const ready = fake.posted[0];
    expect(ready?.targetOrigin).toBe("*");
    const nonce = (ready?.message as { payload: { nonce: string } }).payload
      .nonce;

    fake.dispatchMessage(
      envelope("INIT", {
        nonce: "wrong",
        gatewayBaseUrl: "https://gateway.simtrain.test",
        capabilities: ["auth.getToken"],
      })
    );
    expect(fake.posted).toHaveLength(1);
    fake.dispatchMessage(
      envelope("INIT", {
        nonce,
        gatewayBaseUrl: "https://gateway.simtrain.test",
        capabilities: ["auth.getToken"],
      }),
      "https://app.simtrain.test"
    );

    await expect(pending).resolves.toMatchObject({
      hostOrigin: "https://app.simtrain.test",
      gatewayBaseUrl: "https://gateway.simtrain.test",
    });
    expect(fake.posted[1]?.targetOrigin).toBe("https://app.simtrain.test");
    fake.dispatchMessage(
      envelope("INIT", {
        nonce,
        gatewayBaseUrl: "https://gateway.simtrain.test",
        capabilities: ["auth.getToken"],
      })
    );
    expect(fake.posted[2]?.targetOrigin).toBe("https://app.simtrain.test");
    client.dispose();
  });

  it("accepts an exact HTTP loopback host origin", async () => {
    const fake = new FakeWindow();
    const client = new BridgeClient({
      window: fake as unknown as Window,
      timeoutMs: 20,
      handshakeRetryMs: 100,
    });
    const pending = client.initialize();
    const ready = fake.posted[0]?.message as { payload: { nonce: string } };

    fake.dispatchMessage(
      envelope("INIT", {
        nonce: ready.payload.nonce,
        gatewayBaseUrl: "http://127.0.0.1:8201",
        capabilities: ["auth.getToken"],
      }),
      "http://localhost:8080"
    );

    await expect(pending).resolves.toMatchObject({
      hostOrigin: "http://localhost:8080",
      gatewayBaseUrl: "http://127.0.0.1:8201",
    });
    client.dispose();
  });

  it("correlates token success/failure and ignores the wrong source or origin", async () => {
    const { client, fake } = await initialized();
    const pending = client.getAuthToken();
    await Promise.resolve();
    const request = fake.posted.at(-1)?.message as { requestId: string };

    fake.dispatchMessage(
      envelope(
        "AUTH_TOKEN_V2_RESULT",
        { success: true, token: "ignored", xOrg: "org", expiresInSeconds: 300 },
        request.requestId
      ),
      "https://evil.test"
    );
    fake.dispatchMessage(
      envelope(
        "AUTH_TOKEN_V2_RESULT",
        { success: true, token: "token", xOrg: "org", expiresInSeconds: 300 },
        request.requestId
      )
    );

    await expect(pending).resolves.toEqual({
      token: "token",
      xOrg: "org",
      expiresInSeconds: 300,
    });
    client.dispose();
  });

  it("rejects unsupported capabilities, caller abort, and disposed calls", async () => {
    const { client, fake } = await initialized();
    const navigation = client.navigateTo({ page: "managestudents" });
    await Promise.resolve();
    const request = fake.posted.at(-1)?.message as { requestId: string };
    fake.dispatchMessage(
      envelope("CONTROL_RESULT", { success: true }, request.requestId)
    );
    await expect(navigation).resolves.toBeUndefined();
    const abort = new AbortController();
    abort.abort();
    await expect(client.getAuthToken(abort.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
    client.dispose();
    await expect(client.initialize()).rejects.toBeInstanceOf(SimTrainSdkError);
    await expect(client.initialize()).rejects.toMatchObject({
      code: "DISPOSED",
    });
  });

  it("distinguishes a valid host rejection from an unsupported capability", async () => {
    const { client, fake } = await initialized();
    const navigation = client.navigateTo({ page: "managestudents" });
    await Promise.resolve();
    const request = fake.posted.at(-1)?.message as { requestId: string };

    fake.dispatchMessage(
      envelope(
        "CONTROL_RESULT",
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Navigation is not permitted" },
        },
        request.requestId
      )
    );

    await expect(navigation).rejects.toMatchObject({
      code: "HOST_REQUEST_FAILED",
      message: "Navigation is not permitted",
    });
    client.dispose();
  });
});
