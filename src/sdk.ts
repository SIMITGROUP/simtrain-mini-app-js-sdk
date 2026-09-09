import { Auth } from "./auth/auth";
import { TokenManager } from "./auth/token-manager";
import { BridgeClient } from "./bridge/bridge-client";
import {
  createCurrentMiniAppControls,
  type CurrentMiniAppControls,
} from "./controls/current";
import { createUiControls, type UiControls } from "./controls/ui";
import { SimTrainSdkBase } from "./generated/sdk.base";
import { BrowserTransport } from "./transport/browser-transport";

export class SimTrainSdk extends SimTrainSdkBase {
  /** Access to the current user's managed mini-app token. */
  readonly auth: Auth;
  /** Controls the containing SimTrain application. */
  readonly ui: UiControls;
  /** Controls navigation inside the currently mounted mini app. */
  readonly current: CurrentMiniAppControls;

  private readonly bridge: BridgeClient;
  private readonly tokenManager: TokenManager;
  private readonly browserTransport: BrowserTransport;

  constructor() {
    const bridge = new BridgeClient();
    const tokenManager = new TokenManager(bridge);
    const transport = new BrowserTransport(bridge, tokenManager);
    super(transport);
    this.bridge = bridge;
    this.tokenManager = tokenManager;
    this.browserTransport = transport;
    this.auth = new Auth(tokenManager);
    this.ui = createUiControls(bridge);
    this.current = createCurrentMiniAppControls(bridge);
  }

  dispose(): void {
    this.browserTransport.dispose();
    this.tokenManager.dispose();
    this.bridge.dispose();
  }
}
