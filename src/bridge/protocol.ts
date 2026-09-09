export const BRIDGE_PROTOCOL_V2 = "simtrain-mini-app-sdk" as const;
export const BRIDGE_VERSION_V2 = 2 as const;

export const HOST_CAPABILITIES_V2 = [
  "auth.getToken",
  "ui.navigateTo",
  "current.navigateTo",
  "ui.openOnScreenForm",
] as const;

export type HostCapabilityV2 = (typeof HOST_CAPABILITIES_V2)[number];

export interface BridgeEnvelopeV2<TType extends string, TPayload> {
  readonly protocol: typeof BRIDGE_PROTOCOL_V2;
  readonly version: typeof BRIDGE_VERSION_V2;
  readonly type: TType;
  readonly requestId?: string;
  readonly payload: TPayload;
}

export interface HostInitPayloadV2 {
  readonly nonce: string;
  readonly gatewayBaseUrl: string;
  readonly capabilities: readonly HostCapabilityV2[];
}

export interface AuthTokenPayloadV2 {
  readonly token: string;
  readonly xOrg: string;
  readonly expiresInSeconds: number;
}

export interface NavigateToPayloadV2 {
  readonly page: string;
  readonly id?: string;
  readonly query?: Readonly<Record<string, string>>;
}

export interface NavigateCurrentPayloadV2 {
  readonly path: string;
}

export interface OpenOnScreenFormPayloadV2 {
  readonly resource: string;
  readonly id?: string;
}

export interface BridgeContextV2 {
  readonly hostOrigin: string;
  readonly gatewayBaseUrl: string;
  readonly capabilities: ReadonlySet<HostCapabilityV2>;
}
