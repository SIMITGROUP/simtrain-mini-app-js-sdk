import { resolve } from "node:path";

export interface SyncOptions {
  readonly source: string;
  readonly updateLock: boolean;
  readonly check: boolean;
}

export function parseSyncOptions(arguments_: readonly string[]): SyncOptions {
  let source: string | undefined;
  let updateLock = false;
  let check = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--source") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--source requires a file path");
      }
      source = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--update-lock") {
      updateLock = true;
      continue;
    }
    if (argument === "--check") {
      check = true;
      continue;
    }
    throw new Error(`unknown sync option: ${String(argument)}`);
  }
  if (updateLock && check) {
    throw new Error("--update-lock and --check cannot be used together");
  }
  if (source === undefined) {
    throw new Error("--source is required");
  }
  return { source, updateLock, check };
}
