import { resolve } from "node:path";
import { parseSyncOptions } from "./sync-options";

describe("parseSyncOptions", () => {
  it("requires the maintainer to supply the OpenAPI source explicitly", () => {
    expect(() => parseSyncOptions(["--check"])).toThrow("--source is required");
  });

  it("parses an explicit source and one operating mode", () => {
    expect(parseSyncOptions(["--source", "contract.yaml", "--check"])).toEqual({
      source: resolve("contract.yaml"),
      updateLock: false,
      check: true,
    });
  });

  it("rejects conflicting modes and unknown options", () => {
    expect(() =>
      parseSyncOptions([
        "--source",
        "contract.yaml",
        "--check",
        "--update-lock",
      ])
    ).toThrow("--update-lock and --check cannot be used together");
    expect(() => parseSyncOptions(["--unknown"])).toThrow(
      "unknown sync option"
    );
  });
});
