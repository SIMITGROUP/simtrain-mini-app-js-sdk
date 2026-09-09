# SimTrain Mini App JavaScript SDK

Version 2 is the browser-only SDK for third-party SimTrain mini apps. Its typed
resources and DTOs are generated from the Mini API Gateway V2 OpenAPI contract.
Data requests go directly through the Gateway; host-only UI operations use the
secure SimTrain host bridge.

## Install

```bash
npm install @simitgroup/simtrain-mini-app-js-sdk@^2
```

The SDK is zero-configuration. It receives the Gateway URL and current-user
credential from the SimTrain host, so frontend code must not contain a client
ID, client secret, installation ID, app ID, `x-org`, or manually configured API
base URL.

## Data APIs

```ts
import {
  SimTrainApiError,
  SimTrainSdk,
} from "@simitgroup/simtrain-mini-app-js-sdk";

const sdk = new SimTrainSdk();

try {
  const students = await sdk.students.list({
    page: 1,
    size: 25,
    status: ["active"],
  });

  const currentUser = await sdk.me.get();
  console.log(students.data, currentUser.data);
} catch (error) {
  if (error instanceof SimTrainApiError) {
    console.error(error.status, error.apiCode, error.requestId);
  }
}
```

Every resource call lazily completes the host handshake, obtains a short-lived
V2 mini-app user token, and sends:

```http
Authorization: Bearer <V2 mini-app user token>
```

The Gateway derives the organization context from the token's signed `xOrg`
claim. The SDK never sends a separate `x-org` header.

The SDK refreshes the credential automatically, coalesces concurrent refreshes,
and retries once after an authentication `401`. It stores the token in memory
only. Each SDK instance, iframe, and browser tab has an independent cache.

Call `sdk.dispose()` when permanently unmounting the mini app. Host context
changes and page lifecycle events also invalidate cached credentials and abort
in-flight work.

## Host controls

Controls that only the SimTrain window can perform stay on `postMessage`:

```ts
// Navigate the containing SimTrain application.
await sdk.ui.navigateTo({ page: "invoice", id: "invoice-record-id" });

// Navigate inside the currently mounted mini app.
await sdk.current.navigateTo({ path: "settings/profile" });

// Open a generated Mini API resource form in SimTrain.
await sdk.students.openOnScreenForm(); // add
await sdk.students.openOnScreenForm("student-record-id"); // edit
```

Direct pages backed by public Mini API document resources and reviewed
top-level navigation destinations receive editor autocomplete. Other safe
relative strings remain accepted without being advertised by the SDK.
Current-mini-app paths are also relative. Host validation rejects external
URLs, absolute paths, backslashes, unsafe encoding, and traversal. Form controls
exist only on generated public Mini API document resources; the SDK supplies the
resource name and SimTrain rechecks the current user's permissions.

## Calling your own backend as the logged-in user

`sdk.auth.getToken()` returns the same short-lived V2 bearer token used by SDK
resource calls:

```ts
const token = await sdk.auth.getToken();

await fetch("https://api.your-company.example/action", {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
```

Your backend must verify that token against the fixed SimTrain issuer and JWKS,
including its signature, `RS256`, JOSE type, exact audience set, app ID,
purpose, version, timestamps, and claim types. If it relays the token to the
public Gateway, it must relay only the bearer token and must not accept or send
a separate browser-provided `x-org`; the Gateway derives context from the
verified signed `xOrg` claim. See [Token verification](docs/token-verification.md).

## Backend service accounts

Jobs without a logged-in user use server-side credentials:

```text
clientId + clientSecret -> POST /v2/auth -> service bearer token
```

That flow belongs only in a trusted backend. `/v2/auth`, its DTOs, and client
credentials are intentionally absent from this frontend SDK. The backend sends
the resulting service token in `Authorization` and the installed context in
`x-org` when calling Gateway V2 resources.

## Context, errors, and mutations

Use `sdk.me.get()` for the OpenAPI-defined current-user and organisation view,
including the preferred IANA timezone at
`data.organization.config.timeZone`. Timezone is configuration, so it is not a
user-token claim.

Generated methods accept an optional final request-options object with
`signal`, `timeoutMs`, and `requestId`. The default HTTP timeout is 30 seconds.
For a mutation, a timeout or network error is ambiguous: the server may have
committed the change even though the response was lost. Reconcile state before
manually retrying; a request ID is for correlation and is not automatically an
idempotency key.

The package targets ES2020 and requires an iframe-capable modern browser with
`fetch`, `AbortController`, `URL`, Web Crypto `getRandomValues`, and
`postMessage`. It is not a Node.js or server-side-rendering SDK.

Host and Gateway origins must use HTTPS. Exact HTTP loopback origins
(`localhost`, `127.0.0.1`, and `[::1]`) are also accepted for local
development; all other HTTP origins are rejected.
