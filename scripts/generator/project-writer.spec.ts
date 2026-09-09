import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { GENERATED_HEADER } from "./type-renderer";
import { writeGeneratedProject } from "./project-writer";

const roots: string[] = [];

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sdk-project-writer-"));
  roots.push(root);
  return root;
}

function put(root: string, path: string, content: string): void {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeGeneratedProject", () => {
  it("writes generated files, creates editable files once, and is idempotent", async () => {
    const root = projectRoot();
    const project = {
      generatedFiles: new Map([
        [
          "src/generated/sdk.base.ts",
          `${GENERATED_HEADER}\nexport class Base {}\n`,
        ],
      ]),
      editableFiles: new Map([
        ["src/resources/widgets/widgets.ts", "export class Widgets {}\n"],
      ]),
    };

    const first = await writeGeneratedProject(root, project, false);
    put(root, "src/resources/widgets/widgets.ts", "// developer helper\n");
    const second = await writeGeneratedProject(root, project, false);

    expect(first.written).toBe(2);
    expect(second.written).toBe(0);
    expect(
      readFileSync(join(root, "src/resources/widgets/widgets.ts"), "utf8")
    ).toBe("// developer helper\n");
  });

  it("removes only stale generated files and reports orphaned editable resources", async () => {
    const root = projectRoot();
    put(
      root,
      "src/resources/old/generated/old.base.ts",
      `${GENERATED_HEADER}\nexport class OldBase {}\n`
    );
    put(root, "src/resources/old/old.ts", "export class Old {}\n");

    const result = await writeGeneratedProject(
      root,
      { generatedFiles: new Map(), editableFiles: new Map() },
      false
    );

    expect(result.removed).toBe(1);
    expect(result.orphanedEditableFiles).toEqual(["src/resources/old/old.ts"]);
    expect(
      readFileSync(join(root, "src/resources/old/old.ts"), "utf8")
    ).toContain("Old");
  });

  it("fails closed for non-generated files and check-mode drift", async () => {
    const root = projectRoot();
    put(root, "src/generated/sdk.base.ts", "// handwritten\n");

    await expect(
      writeGeneratedProject(
        root,
        { generatedFiles: new Map(), editableFiles: new Map() },
        false
      )
    ).rejects.toThrow(/refusing to remove non-generated/);
    await expect(
      writeGeneratedProject(
        root,
        {
          generatedFiles: new Map([
            ["src/generated/new.ts", `${GENERATED_HEADER}\nexport {};\n`],
          ]),
          editableFiles: new Map(),
        },
        true
      )
    ).rejects.toThrow(/generated project drift/);
  });
});
