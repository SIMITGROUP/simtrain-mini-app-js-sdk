import process from "node:process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { GENERATED_HEADER } from "./generator/type-renderer";

function sourceFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function memberName(member: ts.ClassElement): string | undefined {
  if (!member.name) return undefined;
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text;
  }
  return undefined;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function classMethods(path: string): ReadonlySet<string> {
  const methods = new Set<string>();
  for (const statement of parse(path).statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (ts.isMethodDeclaration(member)) {
        const name = memberName(member);
        if (name !== undefined) methods.add(name);
      }
    }
  }
  return methods;
}

function assertNoForbiddenSyntax(path: string): void {
  const source = parse(path);
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      throw new Error(`forbidden any type in public SDK source: ${path}`);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Proxy"
    ) {
      throw new Error(
        `JavaScript Proxy is forbidden in public SDK source: ${path}`
      );
    }
    if (ts.isStringLiteralLike(node)) {
      const text = node.text;
      if (
        text.includes("internal.") ||
        text.startsWith("/resources/") ||
        text.includes("openapi-v2.yaml")
      ) {
        throw new Error(
          `forbidden public SDK string ${JSON.stringify(text)} in ${path}`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export function checkGeneratedOwnership(root = process.cwd()): void {
  const sourceRoot = resolve(root, "src");
  for (const path of sourceFiles(sourceRoot)) {
    assertNoForbiddenSyntax(path);
    if (
      path.split(/[\\/]/).includes("generated") &&
      !readFileSync(path, "utf8").startsWith(GENERATED_HEADER.trimEnd())
    ) {
      throw new Error(`generated source lacks ownership header: ${path}`);
    }
  }

  const resources = resolve(sourceRoot, "resources");
  if (!existsSync(resources) || !statSync(resources).isDirectory()) return;
  for (const entry of readdirSync(resources, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const namespace = entry.name;
    const basePath = resolve(
      resources,
      namespace,
      "generated",
      `${namespace}.base.ts`
    );
    const editablePath = resolve(resources, namespace, `${namespace}.ts`);
    if (!existsSync(basePath) || !existsSync(editablePath)) {
      throw new Error(
        `resource ${namespace} is missing its base or editable class`
      );
    }
    const generatedMethods = classMethods(basePath);
    for (const statement of parse(editablePath).statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      for (const member of statement.members) {
        const name = memberName(member);
        if (name !== undefined && generatedMethods.has(name)) {
          throw new Error(
            `${namespace}.${name} shadows a generated wire method in editable source`
          );
        }
      }
    }
  }
}

if (process.argv[1]?.endsWith("check-generated-ownership.ts")) {
  try {
    checkGeneratedOwnership();
    console.log("Generated ownership checks passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
