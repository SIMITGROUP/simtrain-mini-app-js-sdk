import {
  BRIDGE_PROTOCOL_V2,
  HOST_CAPABILITIES_V2,
  type AuthTokenPayloadV2,
  type HostCapabilityV2,
  type HostInitPayloadV2,
} from "./protocol";

type HostMessageV2 =
  | { readonly type: "INIT"; readonly payload: HostInitPayloadV2 }
  | {
      readonly type: "AUTH_TOKEN_V2_RESULT";
      readonly requestId: string;
      readonly payload:
        | ({ readonly success: true } & AuthTokenPayloadV2)
        | { readonly success: false; readonly error: BridgeFailureV2 };
    }
  | {
      readonly type: "CONTROL_RESULT";
      readonly requestId: string;
      readonly payload:
        | { readonly success: true }
        | { readonly success: false; readonly error: BridgeFailureV2 };
    }
  | {
      readonly type: "CONTEXT_INVALIDATED";
      readonly payload: Record<string, never>;
    };

interface BridgeFailureV2 {
  readonly code: string;
  readonly message: string;
}

const MAX_ENVELOPE_BYTES = 32 * 1_024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function boundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0)
  );
}

function safeIdentifier(value: unknown): value is string {
  return boundedString(value, 128) && SAFE_IDENTIFIER.test(value);
}

export function validateGatewayBaseUrl(value: unknown): string | undefined {
  if (!boundedString(value, 2_048)) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) ||
      url.origin === "null" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return value.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function parseFailure(value: unknown): BridgeFailureV2 | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["code", "message"]))
    return undefined;
  if (!safeIdentifier(value.code) || !boundedString(value.message, 1_024)) {
    return undefined;
  }
  return { code: value.code, message: value.message };
}

function parseCapabilities(
  value: unknown
): readonly HostCapabilityV2[] | undefined {
  if (!Array.isArray(value) || value.length > HOST_CAPABILITIES_V2.length) {
    return undefined;
  }
  const known = new Set<string>(HOST_CAPABILITIES_V2);
  const capabilities: HostCapabilityV2[] = [];
  for (const capability of value) {
    if (typeof capability !== "string" || !known.has(capability))
      return undefined;
    if (capabilities.includes(capability as HostCapabilityV2)) return undefined;
    capabilities.push(capability as HostCapabilityV2);
  }
  return capabilities;
}

function hasSafeEnvelopeSize(value: unknown): boolean {
  try {
    const text = JSON.stringify(value);
    let bytes = 0;
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      bytes +=
        codePoint <= 0x7f
          ? 1
          : codePoint <= 0x7ff
            ? 2
            : codePoint <= 0xffff
              ? 3
              : 4;
      if (bytes > MAX_ENVELOPE_BYTES) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isBridgeCandidate(value: unknown): boolean {
  return isRecord(value) && value.protocol === BRIDGE_PROTOCOL_V2;
}

export function parseHostMessage(value: unknown): HostMessageV2 | undefined {
  if (
    !hasSafeEnvelopeSize(value) ||
    !isRecord(value) ||
    !onlyKeys(value, ["protocol", "version", "type", "requestId", "payload"]) ||
    value.protocol !== BRIDGE_PROTOCOL_V2 ||
    value.version !== 2 ||
    !boundedString(value.type, 64) ||
    !isRecord(value.payload)
  ) {
    return undefined;
  }
  if (value.type === "INIT") {
    if (
      value.requestId !== undefined ||
      !onlyKeys(value.payload, ["nonce", "gatewayBaseUrl", "capabilities"]) ||
      !safeIdentifier(value.payload.nonce)
    ) {
      return undefined;
    }
    const gatewayBaseUrl = validateGatewayBaseUrl(value.payload.gatewayBaseUrl);
    const capabilities = parseCapabilities(value.payload.capabilities);
    if (gatewayBaseUrl === undefined || capabilities === undefined)
      return undefined;
    return {
      type: "INIT",
      payload: { nonce: value.payload.nonce, gatewayBaseUrl, capabilities },
    };
  }
  if (value.type === "CONTEXT_INVALIDATED") {
    if (
      value.requestId !== undefined ||
      Object.keys(value.payload).length !== 0
    ) {
      return undefined;
    }
    return { type: "CONTEXT_INVALIDATED", payload: {} };
  }
  if (!safeIdentifier(value.requestId)) return undefined;
  if (value.type === "AUTH_TOKEN_V2_RESULT") {
    if (value.payload.success === true) {
      if (
        !onlyKeys(value.payload, [
          "success",
          "token",
          "xOrg",
          "expiresInSeconds",
        ]) ||
        !boundedString(value.payload.token, 16_384) ||
        !safeIdentifier(value.payload.xOrg) ||
        !Number.isInteger(value.payload.expiresInSeconds) ||
        (value.payload.expiresInSeconds as number) < 1 ||
        (value.payload.expiresInSeconds as number) > 3_600
      ) {
        return undefined;
      }
      return {
        type: value.type,
        requestId: value.requestId,
        payload: {
          success: true,
          token: value.payload.token,
          xOrg: value.payload.xOrg,
          expiresInSeconds: value.payload.expiresInSeconds as number,
        },
      };
    }
    const error = parseFailure(value.payload.error);
    if (
      value.payload.success !== false ||
      !onlyKeys(value.payload, ["success", "error"]) ||
      error === undefined
    ) {
      return undefined;
    }
    return {
      type: value.type,
      requestId: value.requestId,
      payload: { success: false, error },
    };
  }
  if (value.type === "CONTROL_RESULT") {
    if (
      value.payload.success === true &&
      onlyKeys(value.payload, ["success"])
    ) {
      return {
        type: value.type,
        requestId: value.requestId,
        payload: { success: true },
      };
    }
    const error = parseFailure(value.payload.error);
    if (
      value.payload.success !== false ||
      !onlyKeys(value.payload, ["success", "error"]) ||
      error === undefined
    ) {
      return undefined;
    }
    return {
      type: value.type,
      requestId: value.requestId,
      payload: { success: false, error },
    };
  }
  return undefined;
}
