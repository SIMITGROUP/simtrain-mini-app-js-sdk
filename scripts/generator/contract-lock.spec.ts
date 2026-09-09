import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertContractLock,
  createContractLock,
  readContractLock,
  writeContractLockAtomic,
} from "./contract-lock";

const roots: string[] = [];

function contractSource(): { root: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "sdk-contract-lock-"));
  roots.push(root);
  const source = join(root, "openapi-v2.yaml");
  writeFileSync(source, "openapi: 3.0.3\npaths: {}\n");
  return { root, source };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("contract lock", () => {
  it("records only the contract digest and generator version", () => {
    const { source } = contractSource();
    const lock = createContractLock(source, "sdk-generator/1");

    expect({ ...lock, sourceSha256: "DIGEST" }).toEqual({
      version: 1,
      generatorVersion: "sdk-generator/1",
      sourceSha256: "DIGEST",
    });
    expect(JSON.stringify(lock)).toMatch(/[a-f0-9]{64}/);
    expect(() => {
      assertContractLock(lock, source, "sdk-generator/1");
    }).not.toThrow();
  });

  it("fails closed on digest, generator, and missing-lock mismatch", () => {
    const { root, source } = contractSource();
    const lock = createContractLock(source, "sdk-generator/1");

    writeFileSync(source, "openapi: 3.0.3\npaths: { changed: {} }\n");
    expect(() => {
      assertContractLock(lock, source, "sdk-generator/1");
    }).toThrow(/digest mismatch/);

    expect(() => {
      assertContractLock(lock, source, "sdk-generator/2");
    }).toThrow(/generator version mismatch/);
    expect(() => readContractLock(join(root, "missing.json"))).toThrow(
      /contract lock is missing/
    );
  });

  it("replaces a lock atomically without leaving temporary files", () => {
    const { root, source } = contractSource();
    const path = join(root, "contract.lock.json");
    const lock = createContractLock(source, "sdk-generator/1");

    writeContractLockAtomic(path, lock);

    expect(readContractLock(path)).toEqual(lock);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(lock);
    expect(readdirSync(root).filter(name => name.includes(".tmp-"))).toEqual(
      []
    );
  });

  it("does not record the source path or repository metadata", () => {
    const { root, source } = contractSource();
    const lock = createContractLock(source, "sdk-generator/1");
    const serialized = JSON.stringify(lock);

    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("repository");
    expect(serialized).not.toContain("revision");
    expect(serialized).not.toContain("artifact");
  });
});
