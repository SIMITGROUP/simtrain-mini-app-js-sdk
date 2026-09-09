import type { NavigateCurrentPayloadV2 } from "../bridge/protocol";
import type { ControlOptions } from "./ui";

/** Input for navigating inside the currently mounted mini app. */
export interface CurrentNavigateToInput extends NavigateCurrentPayloadV2 {
  /** Relative path below the current mini app's own SimTrain mount point. */
  readonly path: string;
}

/** Controls the currently mounted mini app. */
export interface CurrentMiniAppControls {
  /**
   * Navigates within the current mini app. Use `sdk.ui.navigateTo()` when the
   * destination is a page in the containing SimTrain application.
   */
  navigateTo(
    input: CurrentNavigateToInput,
    options?: ControlOptions
  ): Promise<void>;
}

interface CurrentBridge {
  navigateCurrent(
    input: NavigateCurrentPayloadV2,
    signal?: AbortSignal
  ): Promise<void>;
}

class BridgeCurrentMiniAppControls implements CurrentMiniAppControls {
  constructor(private readonly bridge: CurrentBridge) {}

  navigateTo(
    input: CurrentNavigateToInput,
    options: ControlOptions = {}
  ): Promise<void> {
    return this.bridge.navigateCurrent(input, options.signal);
  }
}

/** @internal */
export function createCurrentMiniAppControls(
  bridge: CurrentBridge
): CurrentMiniAppControls {
  return new BridgeCurrentMiniAppControls(bridge);
}
