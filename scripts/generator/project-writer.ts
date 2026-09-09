import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { RenderedProject } from "./operation-renderer";
import { GENERATED_HEADER } from "./type-renderer";

export interface ProjectWriteResult {
  readonly written: number;
  readonly removed: number;
  readonly orphanedEditableFiles: readonly string[];
}

const GENERATED_PATH =
  /^src\/(?:generated\/[A-Za-z0-9./]+|resources\/[A-Za-z][A-Za-z0-9]*\/generated\/[A-Za-z0-9.]+)\.ts$/;
const EDITABLE_PATH = /^src\/resources\/([A-Za-z][A-Za-z0-9]*)\/\1\.ts$/;
const execFileAsync = promisify(execFile);

function safeRelativePath(path: string, generated: boolean): void {
  const pattern = generated ? GENERATED_PATH : EDITABLE_PATH;
  if (path.includes("..") || path.startsWith("/") || !pattern.test(path)) {
    throw new Error(
      `unsafe ${generated ? "generated" : "editable"} path: ${path}`
    );
  }
}

function findFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function discoverGeneratedFiles(root: string): readonly string[] {
  const files = [...findFiles(resolve(root, "src/generated"))];
  const resources = resolve(root, "src/resources");
  if (existsSync(resources)) {
    for (const entry of readdirSync(resources, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        files.push(...findFiles(resolve(resources, entry.name, "generated")));
      }
    }
  }
  return files;
}

function discoverEditableFiles(root: string): readonly string[] {
  const resources = resolve(root, "src/resources");
  if (!existsSync(resources)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(resources, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(resources, entry.name, `${entry.name}.ts`);
    if (existsSync(candidate)) files.push(candidate);
  }
  return files;
}

export async function writeGeneratedProject(
  root: string,
  project: RenderedProject,
  check: boolean
): Promise<ProjectWriteResult> {
  const absoluteRoot = resolve(root);
  const stage = mkdtempSync(join(tmpdir(), "simtrain-sdk-project-"));
  let written = 0;
  let removed = 0;
  try {
    const stagedGenerated = new Map<string, string>();
    for (const [path, content] of [...project.generatedFiles].sort(
      ([left], [right]) => left.localeCompare(right)
    )) {
      safeRelativePath(path, true);
      if (!content.startsWith(GENERATED_HEADER.trimEnd())) {
        throw new Error(`generated file lacks ownership header: ${path}`);
      }
      const staged = resolve(stage, path);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, content);
      stagedGenerated.set(path, content);
    }
    const stagedEditable = new Map<string, string>();
    for (const [path, content] of [...project.editableFiles].sort(
      ([left], [right]) => left.localeCompare(right)
    )) {
      safeRelativePath(path, false);
      const staged = resolve(stage, path);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, content);
      stagedEditable.set(path, content);
    }

    const stagedPaths = [
      ...[...stagedGenerated.keys()].map(path => resolve(stage, path)),
      ...[...stagedEditable.keys()].map(path => resolve(stage, path)),
    ];
    if (stagedPaths.length > 0) {
      const prettierCli = resolve(
        process.cwd(),
        "node_modules/prettier/bin/prettier.cjs"
      );
      await execFileAsync(process.execPath, [
        prettierCli,
        "--config",
        resolve(process.cwd(), ".prettierrc"),
        "--write",
        ...stagedPaths,
      ]);
      for (const path of stagedGenerated.keys()) {
        stagedGenerated.set(path, readFileSync(resolve(stage, path), "utf8"));
      }
      for (const path of stagedEditable.keys()) {
        stagedEditable.set(path, readFileSync(resolve(stage, path), "utf8"));
      }
    }

    for (const [path, content] of stagedGenerated) {
      const destination = resolve(absoluteRoot, path);
      const current = existsSync(destination)
        ? readFileSync(destination, "utf8")
        : undefined;
      if (current === content) continue;
      if (check) throw new Error(`generated project drift: ${path}`);
      mkdirSync(dirname(destination), { recursive: true });
      renameSync(resolve(stage, path), destination);
      written += 1;
    }
    for (const [path] of stagedEditable) {
      const destination = resolve(absoluteRoot, path);
      if (existsSync(destination)) continue;
      if (check) throw new Error(`generated project drift: missing ${path}`);
      mkdirSync(dirname(destination), { recursive: true });
      renameSync(resolve(stage, path), destination);
      written += 1;
    }

    const desiredGenerated = new Set(project.generatedFiles.keys());
    for (const file of discoverGeneratedFiles(absoluteRoot)) {
      const path = relative(absoluteRoot, file).replaceAll("\\", "/");
      if (desiredGenerated.has(path)) continue;
      const content = readFileSync(file, "utf8");
      if (!content.startsWith(GENERATED_HEADER.trimEnd())) {
        throw new Error(`refusing to remove non-generated file: ${path}`);
      }
      if (check) throw new Error(`generated project drift: stale ${path}`);
      rmSync(file);
      removed += 1;
    }

    const desiredEditable = new Set(project.editableFiles.keys());
    const orphanedEditableFiles = discoverEditableFiles(absoluteRoot)
      .map(file => relative(absoluteRoot, file).replaceAll("\\", "/"))
      .filter(path => !desiredEditable.has(path))
      .sort((left, right) => left.localeCompare(right));
    return { written, removed, orphanedEditableFiles };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
