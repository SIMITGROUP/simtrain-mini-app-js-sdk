import { SimTrainSdk } from "../src";

const HOST_ORIGIN = "https://app.simtrain.test";
const GATEWAY_ORIGIN = "https://gateway.simtrain.test";

interface PostedMessage {
  readonly message: Readonly<Record<string, unknown>>;
  readonly targetOrigin: string;
}

class FakeWindow {
  readonly posted: PostedMessage[] = [];
  readonly parent = {
    postMessage: (
      message: Readonly<Record<string, unknown>>,
      targetOrigin: string
    ): void => {
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

  dispatchMessage(data: unknown, origin = HOST_ORIGIN): void {
    const event = { data, origin, source: this.parent } as unknown as Event;
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }
}

interface TestSdk {
  readonly students: {
    list(params?: { readonly page?: number }): Promise<unknown>;
    openOnScreenForm(id?: string): Promise<void>;
  };
  readonly me: { get(): Promise<unknown> };
  readonly auth: { getToken(): Promise<string> };
  readonly ui: {
    navigateTo(payload: {
      readonly page: string;
      readonly id?: string;
    }): Promise<void>;
  };
  readonly current: {
    navigateTo(payload: { readonly path: string }): Promise<void>;
  };
  dispose(): void;
}

function envelope(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  requestId?: string
): Readonly<Record<string, unknown>> {
  return {
    protocol: "simtrain-mini-app-sdk",
    version: 2,
    type,
    ...(requestId === undefined ? {} : { requestId }),
    payload,
  };
}

describe("SimTrainSdk public facade", () => {
  let windowDescriptor: PropertyDescriptor | undefined;
  let fakeWindow: FakeWindow;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const instances: TestSdk[] = [];

  beforeEach(() => {
    fakeWindow = new FakeWindow();
    windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    fetchSpy = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    for (const sdk of instances) sdk.dispose();
    instances.length = 0;
    fetchSpy.mockRestore();
    if (windowDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    }
  });

  function createSdk(): TestSdk {
    const sdk: TestSdk = new SimTrainSdk();
    instances.push(sdk);
    return sdk;
  }

  function hostMessage(
    type: string,
    payload: Readonly<Record<string, unknown>>,
    requestId?: string
  ): void {
    fakeWindow.dispatchMessage(envelope(type, payload, requestId));
  }

  async function waitForPost(
    type: string,
    occurrence = 1
  ): Promise<PostedMessage> {
    for (let index = 0; index < 20; index += 1) {
      const matches = fakeWindow.posted.filter(
        item => item.message.type === type
      );
      const match = matches[occurrence - 1];
      if (match !== undefined) return match;
      await Promise.resolve();
    }
    throw new Error(`No ${type} message was posted`);
  }

  async function initializeFrom(
    ready: PostedMessage,
    capabilities = [
      "auth.getToken",
      "ui.navigateTo",
      "current.navigateTo",
      "ui.openOnScreenForm",
    ]
  ): Promise<void> {
    const readyPayload = ready.message.payload as { readonly nonce: string };
    hostMessage("INIT", {
      nonce: readyPayload.nonce,
      gatewayBaseUrl: GATEWAY_ORIGIN,
      capabilities,
    });
    await Promise.resolve();
  }

  function completeTokenRequest(request: PostedMessage, token: string): void {
    hostMessage(
      "AUTH_TOKEN_V2_RESULT",
      {
        success: true,
        token,
        xOrg: "org-1",
        expiresInSeconds: 300,
      },
      request.message.requestId as string
    );
  }

  function completeControlRequest(request: PostedMessage): void {
    hostMessage(
      "CONTROL_RESULT",
      { success: true },
      request.message.requestId as string
    );
  }

  it("does not contact the host until the first generated resource call", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: [], pagination: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const sdk = createSdk();

    expect(fakeWindow.posted).toEqual([]);
    const pending = sdk.students.list({ page: 2 });
    const ready = await waitForPost("READY");
    expect(ready.targetOrigin).toBe("*");
    await initializeFrom(ready);
    const tokenRequest = await waitForPost("AUTH_TOKEN_V2");
    completeTokenRequest(tokenRequest, "user-token");

    await expect(pending).resolves.toEqual({ data: [], pagination: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(`${GATEWAY_ORIGIN}/v2/students?page=2`);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer user-token"
    );
    expect(new Headers(init?.headers).has("x-org")).toBe(false);
  });

  it("shares one in-memory user token between auth and generated resources", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const sdk = createSdk();

    const tokenPending = sdk.auth.getToken();
    const ready = await waitForPost("READY");
    await initializeFrom(ready);
    const tokenRequest = await waitForPost("AUTH_TOKEN_V2");
    completeTokenRequest(tokenRequest, "shared-user-token");
    await expect(tokenPending).resolves.toBe("shared-user-token");

    await expect(sdk.me.get()).resolves.toEqual({ data: {} });
    expect(
      fakeWindow.posted.filter(item => item.message.type === "AUTH_TOKEN_V2")
    ).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${GATEWAY_ORIGIN}/v2/me`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("sends only the typed public controls over the host bridge", async () => {
    const sdk = createSdk();
    const navigation = sdk.ui.navigateTo({
      page: "reports/dailyattendance",
      id: "student-1",
    });
    const ready = await waitForPost("READY");
    await initializeFrom(ready);
    const navigateRequest = await waitForPost("UI_NAVIGATE_TO");
    expect(navigateRequest.message.payload).toEqual({
      page: "reports/dailyattendance",
      id: "student-1",
    });
    completeControlRequest(navigateRequest);
    await expect(navigation).resolves.toBeUndefined();

    const current = sdk.current.navigateTo({ path: "settings/profile" });
    const currentRequest = await waitForPost("CURRENT_NAVIGATE_TO");
    expect(currentRequest.message.payload).toEqual({
      path: "settings/profile",
    });
    completeControlRequest(currentRequest);
    await expect(current).resolves.toBeUndefined();

    const addForm = sdk.students.openOnScreenForm();
    const addFormRequest = await waitForPost("UI_OPEN_ON_SCREEN_FORM", 1);
    expect(addFormRequest.message.payload).toEqual({ resource: "students" });
    completeControlRequest(addFormRequest);
    await expect(addForm).resolves.toBeUndefined();

    const editForm = sdk.students.openOnScreenForm("student-1");
    const editFormRequest = await waitForPost("UI_OPEN_ON_SCREEN_FORM", 2);
    expect(editFormRequest.message.payload).toEqual({
      resource: "students",
      id: "student-1",
    });
    completeControlRequest(editFormRequest);
    await expect(editForm).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps token state isolated between SDK instances", async () => {
    const first = createSdk();
    const second = createSdk();

    const firstPending = first.auth.getToken();
    const secondPending = second.auth.getToken();
    const firstReady = await waitForPost("READY", 1);
    const secondReady = await waitForPost("READY", 2);
    await initializeFrom(firstReady, ["auth.getToken"]);
    await initializeFrom(secondReady, ["auth.getToken"]);
    const firstRequest = await waitForPost("AUTH_TOKEN_V2", 1);
    const secondRequest = await waitForPost("AUTH_TOKEN_V2", 2);
    completeTokenRequest(firstRequest, "first-token");
    completeTokenRequest(secondRequest, "second-token");

    await expect(firstPending).resolves.toBe("first-token");
    await expect(secondPending).resolves.toBe("second-token");
    await expect(first.auth.getToken()).resolves.toBe("first-token");
    await expect(second.auth.getToken()).resolves.toBe("second-token");
    expect(
      fakeWindow.posted.filter(item => item.message.type === "AUTH_TOKEN_V2")
    ).toHaveLength(2);
  });

  it("rejects auth, resource, and control calls after disposal", async () => {
    const sdk = createSdk();
    sdk.dispose();

    await expect(sdk.auth.getToken()).rejects.toMatchObject({
      code: "DISPOSED",
    });
    await expect(sdk.me.get()).rejects.toMatchObject({ code: "DISPOSED" });
    await expect(
      sdk.current.navigateTo({ path: "settings" })
    ).rejects.toMatchObject({ code: "DISPOSED" });
    expect(fakeWindow.posted).toEqual([]);
  });
});
