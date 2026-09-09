import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";

interface RunningServer {
  readonly origin: string;
  close(): Promise<void>;
}

interface GatewayRequest {
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly xOrg: string | undefined;
  readonly url: string;
}

interface GatewayState {
  mode: "success" | "unauthorized-once" | "always-unauthorized" | "rate-limit";
  requests: GatewayRequest[];
}

interface HostState {
  readonly messages: ReadonlyArray<{
    readonly type: string;
    readonly requestId?: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }>;
  readonly tokenRequests: number;
  readonly heldTokenRequestId?: string;
  readonly attackSent: boolean;
}

interface BrowserListResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly name: string;
    readonly status?: number;
    readonly apiCode?: string;
    readonly message: string;
    readonly requestId?: string;
    readonly retryAfter?: string;
    readonly rateLimit?: Readonly<Record<string, number>>;
  };
}

declare global {
  interface Window {
    readonly hostHarness: {
      state(): HostState;
      invalidate(): void;
      completeHeldToken(token?: string): void;
      forgeHeldToken(): void;
    };
    readonly miniAppHarness: {
      list(params?: Readonly<Record<string, unknown>>): Promise<unknown>;
      listResult(
        params?: Readonly<Record<string, unknown>>
      ): Promise<BrowserListResult>;
      getToken(): Promise<string>;
      startToken(): void;
      tokenState(): Readonly<Record<string, unknown>>;
      waitForToken(): Promise<void> | undefined;
      navigate(payload: Readonly<Record<string, unknown>>): Promise<void>;
      navigateCurrent(
        payload: Readonly<Record<string, unknown>>
      ): Promise<void>;
      openStudentForm(id?: string): Promise<void>;
      storageState(): Promise<{
        readonly local: string[];
        readonly session: string[];
        readonly indexedDb: Array<string | undefined>;
      }>;
    };
  }
}

const packageRoot = resolve(__dirname, "../..");
const fixturesRoot = resolve(__dirname, "fixtures");
const hostHtml = readFileSync(resolve(fixturesRoot, "host.html"), "utf8");
const miniAppHtml = readFileSync(
  resolve(fixturesRoot, "mini-app.html"),
  "utf8"
);
const attackerHtml = readFileSync(
  resolve(fixturesRoot, "attacker.html"),
  "utf8"
);
const sdkBundle = readFileSync(resolve(packageRoot, "dist/index.mjs"), "utf8");

function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<RunningServer> {
  return new Promise((resolveServer, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolveServer({
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

let hostServer: RunningServer;
let miniAppServer: RunningServer;
let gatewayServer: RunningServer;
let miniAppOrigin = "";
const gatewayState: GatewayState = { mode: "success", requests: [] };

test.beforeAll(async () => {
  gatewayServer = await startServer((request, response) => {
    const requestUrl = request.url ?? "/";
    if (requestUrl === "/attacker.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(attackerHtml);
      return;
    }
    const cors = {
      "access-control-allow-origin": miniAppOrigin,
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "authorization,x-org",
      "access-control-expose-headers":
        "x-request-id,retry-after,x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    gatewayState.requests.push({
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      xOrg: Array.isArray(request.headers["x-org"])
        ? request.headers["x-org"][0]
        : request.headers["x-org"],
      url: requestUrl,
    });
    const attempt = gatewayState.requests.length;
    if (
      gatewayState.mode === "always-unauthorized" ||
      (gatewayState.mode === "unauthorized-once" && attempt === 1)
    ) {
      response.writeHead(401, {
        ...cors,
        "content-type": "application/json",
        "x-request-id": `request-${String(attempt)}`,
      });
      response.end(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Token expired" },
        })
      );
      return;
    }
    if (gatewayState.mode === "rate-limit") {
      response.writeHead(429, {
        ...cors,
        "content-type": "application/json",
        "x-request-id": "request-rate-limited",
        "retry-after": "30",
        "x-ratelimit-limit": "10",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "30",
      });
      response.end(
        JSON.stringify({
          error: { code: "RATE_LIMITED", message: "Too many requests" },
        })
      );
      return;
    }
    response.writeHead(200, {
      ...cors,
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({ data: [], pagination: { page: 1, size: 25 } })
    );
  });
  miniAppServer = await startServer((request, response) => {
    if (request.url === "/sdk.mjs") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(sdkBundle);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(miniAppHtml);
  });
  miniAppOrigin = miniAppServer.origin;
  hostServer = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(hostHtml);
  });
});

test.afterAll(async () => {
  await Promise.all([
    hostServer.close(),
    miniAppServer.close(),
    gatewayServer.close(),
  ]);
});

test.beforeEach(() => {
  gatewayState.mode = "success";
  gatewayState.requests = [];
});

async function loadHarness(
  page: Page,
  options: { readonly holdToken?: boolean } = {}
): Promise<Frame> {
  const query = new URLSearchParams({
    miniAppUrl: `${miniAppServer.origin}/mini-app.html`,
    gatewayUrl: gatewayServer.origin,
    attackerUrl: `${gatewayServer.origin}/attacker.html`,
    ...(options.holdToken ? { holdToken: "1" } : {}),
  });
  await page.goto(`${hostServer.origin}/?${query.toString()}`);
  const frame = page
    .frames()
    .find(item => item.url().startsWith(miniAppOrigin));
  if (frame === undefined) throw new Error("Mini-app frame did not load");
  await frame.waitForFunction(() => typeof window.miniAppHarness === "object");
  return frame;
}

async function hostState(page: Page): Promise<HostState> {
  return page.evaluate(() => window.hostHarness.state());
}

test("lazily authenticates and sends a generated resource call to Gateway", async ({
  page,
}) => {
  const frame = await loadHarness(page);
  expect((await hostState(page)).messages).toEqual([]);

  await expect(
    frame.evaluate(() => window.miniAppHarness.list({ page: 2 }))
  ).resolves.toMatchObject({ data: [] });

  const state = await hostState(page);
  expect(state.messages.map(message => message.type)).toEqual(
    expect.arrayContaining(["READY", "ACK", "AUTH_TOKEN_V2"])
  );
  expect(gatewayState.requests).toEqual([
    {
      authorization: "Bearer token-1",
      origin: miniAppOrigin,
      xOrg: undefined,
      url: "/v2/students?page=2",
    },
  ]);
  await expect(
    frame.evaluate(() => window.miniAppHarness.storageState())
  ).resolves.toEqual({ local: [], session: [], indexedDb: [] });
});

test("refreshes once after 401 and never loops on repeated 401", async ({
  page,
}) => {
  gatewayState.mode = "unauthorized-once";
  let frame = await loadHarness(page);
  await expect(
    frame.evaluate(() => window.miniAppHarness.list({ page: 1 }))
  ).resolves.toMatchObject({ data: [] });
  expect(gatewayState.requests.map(request => request.authorization)).toEqual([
    "Bearer token-1",
    "Bearer token-2",
  ]);
  expect((await hostState(page)).tokenRequests).toBe(2);

  gatewayState.mode = "always-unauthorized";
  gatewayState.requests = [];
  frame = await loadHarness(page);
  const result = await frame.evaluate(() =>
    window.miniAppHarness.listResult({ page: 1 })
  );
  expect(result).toMatchObject({
    ok: false,
    error: { status: 401, apiCode: "UNAUTHORIZED" },
  });
  expect(gatewayState.requests).toHaveLength(2);
});

test("surfaces a readable rate-limit error", async ({ page }) => {
  gatewayState.mode = "rate-limit";
  const frame = await loadHarness(page);

  await expect(
    frame.evaluate(() => window.miniAppHarness.listResult())
  ).resolves.toEqual({
    ok: false,
    error: {
      name: "SimTrainApiError",
      status: 429,
      apiCode: "RATE_LIMITED",
      message: "Too many requests",
      requestId: "request-rate-limited",
      retryAfter: "30",
      rateLimit: { limit: 10, remaining: 0, reset: 30 },
    },
  });
});

test("ignores a correlated token response from a sibling origin", async ({
  page,
}) => {
  const frame = await loadHarness(page, { holdToken: true });
  await frame.evaluate(() => {
    window.miniAppHarness.startToken();
  });
  await expect
    .poll(async () => (await hostState(page)).heldTokenRequestId)
    .not.toBeUndefined();

  await page.evaluate(() => {
    window.hostHarness.forgeHeldToken();
  });
  await expect.poll(async () => (await hostState(page)).attackSent).toBe(true);
  await expect
    .poll(() => frame.evaluate(() => window.miniAppHarness.tokenState()))
    .toEqual({ status: "pending" });

  await page.evaluate(() => {
    window.hostHarness.completeHeldToken("legitimate-token");
  });
  await frame.evaluate(() => window.miniAppHarness.waitForToken());
  await expect(
    frame.evaluate(() => window.miniAppHarness.tokenState())
  ).resolves.toEqual({ status: "fulfilled", token: "legitimate-token" });
});

test("invalidates context and re-handshakes before the next call", async ({
  page,
}) => {
  const frame = await loadHarness(page);
  await frame.evaluate(() => window.miniAppHarness.list());
  await page.evaluate(() => {
    window.hostHarness.invalidate();
  });
  await frame.evaluate(() => window.miniAppHarness.list());

  const state = await hostState(page);
  expect(
    state.messages.filter(message => message.type === "READY")
  ).toHaveLength(2);
  expect(state.tokenRequests).toBe(2);
  expect(gatewayState.requests.map(request => request.authorization)).toEqual([
    "Bearer token-1",
    "Bearer token-2",
  ]);
});

test("routes navigation and forms to the host without a Gateway request", async ({
  page,
}) => {
  const frame = await loadHarness(page);
  await frame.evaluate(async () => {
    await window.miniAppHarness.navigate({
      page: "managestudents",
      id: "student-1",
    });
    await window.miniAppHarness.navigateCurrent({ path: "settings/profile" });
    await window.miniAppHarness.openStudentForm("student-1");
  });

  expect((await hostState(page)).messages.map(message => message.type)).toEqual(
    expect.arrayContaining([
      "UI_NAVIGATE_TO",
      "CURRENT_NAVIGATE_TO",
      "UI_OPEN_ON_SCREEN_FORM",
    ])
  );
  expect(gatewayState.requests).toEqual([]);
});
