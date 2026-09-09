import type { AuthContextSnapshot } from "../../src/auth/auth-context";
import { BrowserTransport } from "../../src/transport/browser-transport";

function context(token = "token-1", generation = 1): AuthContextSnapshot {
  return {
    token,
    expiresAtMonotonicMs: 100_000,
    generation,
  };
}

function setup(responses: readonly Response[]) {
  let invalidated: (() => void) | undefined;
  const bridge = {
    initialize: jest.fn().mockResolvedValue({
      hostOrigin: "https://app.simtrain.test",
      gatewayBaseUrl: "https://gateway.simtrain.test",
      capabilities: new Set(["auth.getToken"]),
    }),
    onContextInvalidated: jest.fn((listener: () => void) => {
      invalidated = listener;
      return () => {
        invalidated = undefined;
      };
    }),
    openOnScreenForm: jest.fn().mockResolvedValue(undefined),
  };
  const tokenManager = {
    getContext: jest
      .fn()
      .mockResolvedValueOnce(context())
      .mockResolvedValue(context("token-2", 2)),
    invalidate: jest.fn().mockReturnValue(true),
  };
  const fetch = jest.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    bridge,
    tokenManager,
    fetch,
    transport: new BrowserTransport(bridge, tokenManager, fetch),
    invalidateHost: () => invalidated?.(),
  };
}

describe("BrowserTransport", () => {
  it("delegates generated resource forms to the host bridge without HTTP", async () => {
    const state = setup([]);

    await expect(
      state.transport.openOnScreenForm("students", "student-1")
    ).resolves.toBeUndefined();
    expect(state.bridge.openOnScreenForm).toHaveBeenCalledWith(
      { resource: "students", id: "student-1" },
      undefined
    );
    expect(state.fetch).not.toHaveBeenCalled();

    state.transport.dispose();
  });

  it("sends only managed context headers and strict fetch options", async () => {
    const state = setup([
      new Response(JSON.stringify({ data: { id: "one" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);

    await expect(
      state.transport.request(
        {
          operationId: "getStudent",
          method: "GET",
          path: "/v2/students/{id}",
          pathParameters: { id: "a/b" },
          query: [
            { name: "tag", value: ["x", "y"], style: "form", explode: true },
          ],
          successStatuses: [200],
          responseMediaType: "application/json",
        },
        { requestId: "request-1" }
      )
    ).resolves.toEqual({ data: { id: "one" } });

    const [url, init] = state.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://gateway.simtrain.test/v2/students/a%2Fb?tag=x&tag=y"
    );
    expect(init).toMatchObject({
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(Object.fromEntries(new Headers(init.headers).entries())).toEqual({
      accept: "application/json",
      authorization: "Bearer token-1",
      "x-request-id": "request-1",
    });
    state.transport.dispose();
  });

  it("sends JSON bodies and handles empty and text success responses", async () => {
    const state = setup([
      new Response(null, { status: 204 }),
      new Response("exported", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    ]);
    await expect(
      state.transport.request<undefined>({
        operationId: "deleteStudent",
        method: "DELETE",
        path: "/v2/students/{id}",
        pathParameters: { id: "one" },
        body: { reason: "done" },
        requestMediaType: "application/json",
        successStatuses: [204],
      })
    ).resolves.toBeUndefined();
    await expect(
      state.transport.request<string>({
        operationId: "exportStudents",
        method: "GET",
        path: "/v2/students/export",
        successStatuses: [200],
        responseMediaType: "text/plain",
      })
    ).resolves.toBe("exported");
    const calls = state.fetch.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[1].body).toBe(JSON.stringify({ reason: "done" }));
    state.transport.dispose();
  });

  it("invalidates the exact auth generation and retries one 401 once", async () => {
    const state = setup([
      new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "old" } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        }
      ),
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);

    await expect(
      state.transport.request({
        operationId: "listStudents",
        method: "GET",
        path: "/v2/students",
        successStatuses: [200],
        responseMediaType: "application/json",
      })
    ).resolves.toEqual({ data: [] });
    expect(state.tokenManager.invalidate).toHaveBeenCalledWith(1);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    const calls = state.fetch.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(new Headers(calls[1]?.[1].headers).get("authorization")).toBe(
      "Bearer token-2"
    );
    state.transport.dispose();
  });

  it("distinguishes malformed JSON, network failure, timeout, and caller abort", async () => {
    const malformed = setup([
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    await expect(
      malformed.transport.request({
        operationId: "getStudent",
        method: "GET",
        path: "/v2/students/one",
        successStatuses: [200],
        responseMediaType: "application/json",
      })
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    malformed.transport.dispose();

    const network = setup([]);
    network.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(
      network.transport.request({
        operationId: "getStudent",
        method: "GET",
        path: "/v2/students/one",
        successStatuses: [200],
      })
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    network.transport.dispose();

    const aborted = setup([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      aborted.transport.request(
        {
          operationId: "getStudent",
          method: "GET",
          path: "/v2/students/one",
          successStatuses: [200],
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: "ABORTED" });
    aborted.transport.dispose();
  });

  it("enforces a bounded HTTP timeout across the request", async () => {
    jest.useFakeTimers();
    const state = setup([]);
    state.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new TypeError("aborted"));
          });
        })
    );
    const request = state.transport.request(
      {
        operationId: "getStudent",
        method: "GET",
        path: "/v2/students/one",
        successStatuses: [200],
      },
      { timeoutMs: 50 }
    );
    const timedOut = expect(request).rejects.toMatchObject({
      code: "HTTP_TIMEOUT",
    });
    await jest.advanceTimersByTimeAsync(51);

    await timedOut;
    state.transport.dispose();
    jest.useRealTimers();
  });

  it("reports disposal for an in-flight Gateway request", async () => {
    const state = setup([]);
    let started!: () => void;
    const fetchStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    state.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          started();
          init.signal?.addEventListener("abort", () => {
            reject(new TypeError("aborted"));
          });
        })
    );
    const pending = state.transport.request({
      operationId: "getStudent",
      method: "GET",
      path: "/v2/students/one",
      successStatuses: [200],
    });
    await fetchStarted;

    state.transport.dispose();

    await expect(pending).rejects.toMatchObject({ code: "DISPOSED" });
  });
});
