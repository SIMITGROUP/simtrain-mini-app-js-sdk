import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ContractLock {
  readonly version: 1;
  readonly generatorVersion: string;
  readonly sourceSha256: string;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function createContractLock(
  sourcePath: string,
  generatorVersion: string
): ContractLock {
  if (!generatorVersion) {
    throw new Error("generator version must not be empty");
  }
  return {
    version: 1,
    generatorVersion,
    sourceSha256: digest(resolve(sourcePath)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLock(value: unknown): ContractLock {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("contract lock has an unsupported format or version");
  }
  if (typeof value.generatorVersion !== "string" || !value.generatorVersion) {
    throw new Error("contract lock generatorVersion is invalid");
  }
  if (
    typeof value.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceSha256)
  ) {
    throw new Error("contract lock sourceSha256 is invalid");
  }
  return {
    version: 1,
    generatorVersion: value.generatorVersion,
    sourceSha256: value.sourceSha256,
  };
}

export function readContractLock(path: string): ContractLock {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`contract lock is missing or unreadable: ${path}`);
  }
  try {
    return parseLock(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`contract lock is not valid JSON: ${path}`);
    }
    throw error;
  }
}

export function assertContractLock(
  lock: ContractLock,
  sourcePath: string,
  generatorVersion: string
): void {
  if (lock.generatorVersion !== generatorVersion) {
    throw new Error(
      `contract generator version mismatch: locked ${lock.generatorVersion}, current ${generatorVersion}`
    );
  }
  const actualSha256 = digest(resolve(sourcePath));
  if (lock.sourceSha256 !== actualSha256) {
    throw new Error(
      `contract digest mismatch: locked ${lock.sourceSha256}, current ${actualSha256}`
    );
  }
}

export function writeContractLockAtomic(
  path: string,
  lock: ContractLock
): void {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
