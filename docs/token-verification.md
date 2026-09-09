# Verify a SimTrain V2 mini-app user token

A frontend obtains the logged-in user's short-lived bearer token with
`sdk.auth.getToken()`. A third-party backend may accept that token to identify
the SimTrain user and may relay it to public Mini API Gateway V2 operations for
the token's remaining lifetime.

The token is a signed JWT, not encrypted data. Treat it as a bearer credential:
send it only over HTTPS in an `Authorization` header, keep it out of URLs, logs,
analytics, cookies, and persistent storage, and discard it after use.

## Required verification policy

Configure these values on the backend; never obtain them from an unverified
token:

- Expected SimTrain issuer.
- Trusted JWKS URL: `<expected issuer>/.well-known/jwks.json`.
- Your Developer Portal app ID (`miniAppId`).
- Gateway audience: `mini-api-gateway`.

Accept a token only when all of these checks pass:

- Signature validates with a trusted JWKS key selected by a bounded `kid`.
- JOSE algorithm is exactly `RS256` and `typ` is exactly
  `simtrain-mini-app-user+jwt`.
- `iss` equals the configured issuer.
- `aud` is an array containing exactly `mini-api-gateway` and your Developer
  Portal app ID, with no duplicate or additional audience.
- `tokenVersion === 2`, `tokenUse === "mini-app-user-access"`, and
  `miniAppId` equals your configured app ID.
- `iat` and `exp` are integers, the token is currently valid with no more than
  30 seconds clock tolerance, and `exp - iat` is at most 300 seconds.
- Required identity and context claims have the expected bounded scalar/array
  types. Reject malformed data instead of coercing it.

Do not follow `jku`, `x5u`, `iss`, or another URL supplied by the token. The
JWKS may contain overlapping public keys during rotation. Select keys only by a
bounded `kid` from the configured JWKS URL, and reject the token if its key is
unavailable.

## Example with `jose`

Install `jose` in your backend application, then apply both cryptographic and
application-level validation:

```ts
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const EXPECTED_ISSUER = process.env.SIMTRAIN_MINI_APP_TOKEN_ISSUER!;
const MINI_APP_ID = process.env.SIMTRAIN_MINI_APP_ID!;
const GATEWAY_AUDIENCE = "mini-api-gateway";
const TOKEN_TYPE = "simtrain-mini-app-user+jwt";
const KID = /^[A-Za-z0-9._:-]{1,128}$/;
const CLOCK_TOLERANCE_SECONDS = 30;

const jwks = createRemoteJWKSet(
  new URL(`${EXPECTED_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`),
  {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 300_000,
  }
);

export interface VerifiedMiniAppUserClaims {
  readonly iss: string;
  readonly sub: string;
  readonly uid: string;
  readonly aud: readonly string[];
  readonly miniAppId: string;
  readonly tenantId: number;
  readonly orgId: number;
  readonly branchId: number;
  readonly orgRecordId: string;
  readonly branchRecordId: string;
  readonly xOrg: string;
  readonly email: string;
  readonly name: string;
  readonly groups: readonly string[];
  readonly group: string;
  readonly origin: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

function string(
  value: unknown,
  maximum: number,
  empty = false
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (empty || value.length > 0)
  );
}

function contextId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function canonicalOrigin(value: unknown): value is string {
  if (!string(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function inspectUntrustedHeader(token: string): void {
  if (
    Buffer.byteLength(token, "utf8") > 8_192 ||
    token.split(".").length !== 3
  ) {
    throw new Error("Invalid mini-app token size or shape");
  }
  const header = decodeProtectedHeader(token);
  if (
    header.alg !== "RS256" ||
    header.typ !== TOKEN_TYPE ||
    !string(header.kid, 128) ||
    !KID.test(header.kid) ||
    "jku" in header ||
    "x5u" in header
  ) {
    throw new Error("Invalid mini-app token header");
  }
}

export async function verifyMiniAppUserToken(
  token: string
): Promise<VerifiedMiniAppUserClaims> {
  inspectUntrustedHeader(token); // before any remote JWKS lookup

  const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"],
    issuer: EXPECTED_ISSUER,
    audience: MINI_APP_ID,
    typ: TOKEN_TYPE,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    maxTokenAge: "5m",
    requiredClaims: [
      "iss",
      "sub",
      "uid",
      "aud",
      "exp",
      "iat",
      "jti",
      "tokenVersion",
      "tokenUse",
      "miniAppId",
      "tenantId",
      "orgId",
      "branchId",
      "orgRecordId",
      "branchRecordId",
      "xOrg",
      "email",
      "name",
      "groups",
      "group",
      "origin",
    ],
  });

  if (protectedHeader.alg !== "RS256" || protectedHeader.typ !== TOKEN_TYPE) {
    throw new Error("Invalid mini-app token header");
  }
  if (
    !Array.isArray(payload.aud) ||
    !payload.aud.every(item => typeof item === "string")
  ) {
    throw new Error("Invalid mini-app token audience");
  }
  const audiences = new Set(payload.aud);
  if (
    payload.aud.length !== 2 ||
    audiences.size !== 2 ||
    !audiences.has(GATEWAY_AUDIENCE) ||
    !audiences.has(MINI_APP_ID)
  ) {
    throw new Error("Invalid mini-app token audience");
  }

  const groups = payload.groups;
  const now = Math.floor(Date.now() / 1_000);
  if (
    payload.tokenVersion !== 2 ||
    payload.tokenUse !== "mini-app-user-access" ||
    payload.miniAppId !== MINI_APP_ID ||
    !string(payload.sub, 256) ||
    !string(payload.uid, 256) ||
    !contextId(payload.tenantId) ||
    !contextId(payload.orgId) ||
    !contextId(payload.branchId) ||
    !string(payload.orgRecordId, 256) ||
    !string(payload.branchRecordId, 256) ||
    !string(payload.xOrg, 512) ||
    !string(payload.email, 320) ||
    !string(payload.name, 1_024) ||
    !Array.isArray(groups) ||
    groups.length > 64 ||
    !groups.every(group => string(group, 128)) ||
    new Set(groups).size !== groups.length ||
    !string(payload.group, 128, true) ||
    (payload.group !== "" && !groups.includes(payload.group)) ||
    !canonicalOrigin(payload.origin) ||
    !string(payload.jti, 128) ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    (payload.exp as number) <= (payload.iat as number) ||
    (payload.exp as number) - (payload.iat as number) > 300 ||
    (payload.iat as number) > now + CLOCK_TOLERANCE_SECONDS ||
    Object.hasOwn(payload, "installationId") ||
    Object.hasOwn(payload, "timezoneOffsetMinute")
  ) {
    throw new Error("Invalid mini-app token claims");
  }

  return Object.freeze({
    iss: payload.iss!,
    sub: payload.sub,
    uid: payload.uid,
    aud: Object.freeze([...payload.aud]),
    miniAppId: payload.miniAppId,
    tenantId: payload.tenantId,
    orgId: payload.orgId,
    branchId: payload.branchId,
    orgRecordId: payload.orgRecordId,
    branchRecordId: payload.branchRecordId,
    xOrg: payload.xOrg,
    email: payload.email,
    name: payload.name,
    groups: Object.freeze([...groups]),
    group: payload.group,
    origin: payload.origin,
    iat: payload.iat!,
    exp: payload.exp!,
    jti: payload.jti!,
  });
}
```

The preflight header inspection is not authentication; it only prevents an
oversized token or attacker-controlled key URL/identifier from reaching the
remote-key resolver. Trust claims only after `jwtVerify` and every explicit
application-level check succeed. The function returns a narrowed copy rather
than the JWT library's open-ended raw payload.

## Relaying the user token to Mini API Gateway

After verification, a backend can call a browser-visible V2 operation as that
user:

```ts
await verifyMiniAppUserToken(receivedBearerToken);

const response = await fetch(`${MINI_API_GATEWAY_URL}/v2/students`, {
  headers: {
    authorization: `Bearer ${receivedBearerToken}`,
  },
});
```

Do not accept or send a separate `x-org` value for this flow. The Gateway
revalidates the user token and derives organization context from its signed
`xOrg` claim. It also rechecks the app, scope, installation, and rate limits;
SimTrain remains authoritative for user permissions and data isolation.

This relay is explicit on-behalf-of access. Possession of the token lets your
backend act as that user on browser-visible public V2 operations until expiry.
Do not exchange it for or combine it with a service credential.

## Service-account flow is separate

A backend task that does not act as the logged-in user obtains a service token
with its own `clientId` and `clientSecret` through `POST /v2/auth`, then uses
that service token as `Authorization: Bearer ...`. Never send client credentials
to a frontend and never call `/v2/auth` through this SDK.
