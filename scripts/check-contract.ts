import process from "node:process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { loadSdkContract } from "./generator/openapi-loader";

interface GeneratedOperation {
  readonly namespace: string;
  readonly methodName: string;
  readonly operationId: string;
}

function generatedOperations(root: string): readonly GeneratedOperation[] {
  const resources = resolve(root, "src/resources");
  const operations: GeneratedOperation[] = [];
  for (const entry of readdirSync(resources, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(
      resources,
      entry.name,
      "generated",
      `${entry.name}.base.ts`
    );
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) {
          continue;
        }
        let operationId: string | undefined;
        const visit = (node: ts.Node): void => {
          if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === "operationId" &&
            ts.isStringLiteral(node.initializer)
          ) {
            operationId = node.initializer.text;
          }
          ts.forEachChild(node, visit);
        };
        if (member.body !== undefined) visit(member.body);
        if (operationId === undefined) {
          if (member.name.text === "openOnScreenForm") continue;
          throw new Error(
            `${entry.name}.${member.name.text} has no operationId`
          );
        }
        operations.push({
          namespace: entry.name,
          methodName: member.name.text,
          operationId,
        });
      }
    }
  }
  return operations;
}

function parseSource(arguments_: readonly string[]): string | undefined {
  const sourceIndex = arguments_.indexOf("--source");
  if (sourceIndex >= 0) {
    const source = arguments_[sourceIndex + 1];
    if (!source) throw new Error("--source requires a path");
    return resolve(source);
  }
  return undefined;
}

export function checkContract(
  root = process.cwd(),
  sourcePath = parseSource(process.argv.slice(2))
): void {
  const packageJson = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8")
  ) as unknown;
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string" ||
    !packageJson.version.startsWith("2.")
  ) {
    throw new Error(
      "the initial V2 contract baseline requires package major 2"
    );
  }

  const generated = generatedOperations(root);
  const generatedKeys = new Set(
    generated.map(
      operation =>
        `${operation.namespace}.${operation.methodName}:${operation.operationId}`
    )
  );
  if (generatedKeys.size !== generated.length || generated.length === 0) {
    throw new Error(
      "generated operation inventory is empty or contains duplicates"
    );
  }
  if (sourcePath === undefined) return;
  if (!existsSync(sourcePath)) {
    throw new Error(`OpenAPI source is missing: ${sourcePath}`);
  }

  const canonical = loadSdkContract(sourcePath).operations;
  const canonicalKeys = new Set(
    canonical.map(
      operation =>
        `${operation.namespace}.${operation.methodName}:${operation.operationId}`
    )
  );
  const missing = [...canonicalKeys].filter(key => !generatedKeys.has(key));
  const extra = [...generatedKeys].filter(key => !canonicalKeys.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `generated operation inventory mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`
    );
  }
}

if (process.argv[1]?.endsWith("check-contract.ts")) {
  try {
    const arguments_ = process.argv.slice(2);
    checkContract(process.cwd(), parseSource(arguments_));
    console.log("Generated contract inventory checks passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
