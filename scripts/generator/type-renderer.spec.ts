import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSdkContractFromText } from "./openapi-loader";
import { buildSchemaGraph } from "./schema-graph";
import { renderDtoFiles } from "./type-renderer";

describe("renderDtoFiles", () => {
  const contract = loadSdkContractFromText(
    readFileSync(resolve("test/fixtures/openapi/schema-contract.yaml"), "utf8")
  );
  const files = renderDtoFiles(buildSchemaGraph(contract.schemas));

  it("preserves required, optional, nullable, enums, arrays, maps, and formats", () => {
    const user = files.get("User.ts");
    expect(user).toContain("export interface User");
    expect(user).toContain("id: string;");
    expect(user).toContain("nickname?: string | null;");
    expect(user).toContain("createdAt: string;");
    expect(user).toContain('role: "student" | "teacher";');
    expect(user).toContain("tags?: string[];");
    expect(user).toContain("metadata?: Record<string, string>;");
    expect(user).toContain("manager?: User;");
    expect(user).toContain("@format v2-datetime");
    expect(user).toContain("@minimum 0");
    expect(user).toContain("@maximum 100");
    expect(user).toContain("@default 0");
  });

  it("preserves refs, composition, discriminators, recursion, and free-form schemas", () => {
    expect(files.get("Staff.ts")).toContain("Entity & {\n  user: User;\n}");
    expect(files.get("SearchResult.ts")).toContain("User | Staff");
    expect(files.get("SearchResult.ts")).toContain("@discriminator kind");
    expect(files.get("LooseValue.ts")).toContain(
      "export type LooseValue = unknown;"
    );
    expect(files.get("Labels.ts")).toContain(
      "export type Labels = Record<string, string>;"
    );
    expect(files.get("MaybeEntity.ts")).toContain("Entity | string | null");
    expect(files.get("NumericState.ts")).toContain("1 | 2");
  });

  it("emits deterministic generated files and a sorted barrel without any", () => {
    expect([...files.keys()]).toEqual([...files.keys()].sort());
    expect(files.get("index.ts")).toContain(
      'export type { Entity } from "./Entity";'
    );
    for (const content of files.values()) {
      expect(content.startsWith("// @generated")).toBe(true);
      expect(content).not.toMatch(/\bany\b/);
    }
  });
});
