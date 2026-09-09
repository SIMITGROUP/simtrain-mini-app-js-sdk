import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEntryBundleSizes } from "./check-bundle-size";

describe("assertEntryBundleSizes", () => {
  it("reports compressed ESM and CommonJS entry sizes within the budget", () => {
    const root = mkdtempSync(join(tmpdir(), "simtrain-sdk-bundle-"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/index.mjs"), "export const value = 1;");
    writeFileSync(join(root, "dist/index.cjs"), "exports.value = 1;");

    expect(assertEntryBundleSizes(root, 1_024)).toEqual([
      expect.objectContaining({ file: "dist/index.mjs" }),
      expect.objectContaining({ file: "dist/index.cjs" }),
    ]);
  });

  it("fails when either compressed entry exceeds the reviewed budget", () => {
    const root = mkdtempSync(join(tmpdir(), "simtrain-sdk-bundle-"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/index.mjs"), "export const value = 1;");
    writeFileSync(join(root, "dist/index.cjs"), "exports.value = 1;");

    expect(() => assertEntryBundleSizes(root, 1)).toThrow(
      "dist/index.mjs compressed size"
    );
  });
});
