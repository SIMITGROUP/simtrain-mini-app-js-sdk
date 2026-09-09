import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

export const MAX_COMPRESSED_ENTRY_BYTES = 100 * 1_024;

export interface EntryBundleSize {
  readonly file: string;
  readonly compressedBytes: number;
}

const ENTRY_FILES = ["dist/index.mjs", "dist/index.cjs"] as const;

export function assertEntryBundleSizes(
  root = process.cwd(),
  maximumBytes = MAX_COMPRESSED_ENTRY_BYTES
): readonly EntryBundleSize[] {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("bundle size budget must be a positive integer");
  }
  return ENTRY_FILES.map(file => {
    const path = resolve(root, file);
    if (!existsSync(path)) throw new Error(`missing built entry ${file}`);
    const compressedBytes = gzipSync(readFileSync(path)).byteLength;
    if (compressedBytes > maximumBytes) {
      throw new Error(
        `${file} compressed size ${String(compressedBytes)} bytes exceeds ${String(maximumBytes)} bytes`
      );
    }
    return Object.freeze({ file, compressedBytes });
  });
}

if (process.argv[1]?.endsWith("check-bundle-size.ts")) {
  try {
    const sizes = assertEntryBundleSizes();
    for (const size of sizes) {
      console.log(`${size.file}: ${String(size.compressedBytes)} bytes gzip`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
