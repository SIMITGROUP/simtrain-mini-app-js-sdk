import type { NavigateToPayloadV2 } from "../bridge/protocol";
import type { SimTrainPage } from "./pages";

/** Input for navigating the containing SimTrain application. */
export interface NavigateToInput {
  /** SimTrain page path relative to the current organization. */
  readonly page: SimTrainPage;
  /** Optional record ID or single child route segment appended to `page`. */
  readonly id?: string;
  /** Optional query values encoded by SimTrain. */
  readonly query?: Readonly<Record<string, string>>;
}

/** Options shared by SDK controls that call the SimTrain host. */
export interface ControlOptions {
  /** Cancels the pending host request. */
  readonly signal?: AbortSignal | undefined;
}

/** Controls the containing SimTrain application. */
export interface UiControls {
  /**
   * Navigates SimTrain itself. Use `sdk.current.navigateTo()` instead when the
   * destination is a page inside the currently mounted mini app.
   */
  navigateTo(input: NavigateToInput, options?: ControlOptions): Promise<void>;
}

interface UiBridge {
  navigateTo(input: NavigateToPayloadV2, signal?: AbortSignal): Promise<void>;
}

class BridgeUiControls implements UiControls {
  constructor(private readonly bridge: UiBridge) {}

  navigateTo(
    input: NavigateToInput,
    options: ControlOptions = {}
  ): Promise<void> {
    return this.bridge.navigateTo(input, options.signal);
  }
}

/** @internal */
export function createUiControls(bridge: UiBridge): UiControls {
  return new BridgeUiControls(bridge);
}
