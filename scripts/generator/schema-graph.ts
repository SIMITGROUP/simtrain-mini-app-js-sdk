import type { OpenApiSchema, SdkOperation } from "./openapi-model";

export interface SchemaNode {
  readonly name: string;
  readonly fileName: string;
  readonly schema: OpenApiSchema;
  readonly references: readonly string[];
}

const SAFE_TYPE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

function componentNameFromReference(reference: string): string | undefined {
  const prefix = "#/components/schemas/";
  if (!reference.startsWith(prefix)) return undefined;
  return reference
    .slice(prefix.length)
    .replaceAll("~1", "/")
    .replaceAll("~0", "~");
}

function collectReferences(
  schema: OpenApiSchema,
  references: Set<string>
): void {
  if (schema.$ref !== undefined) {
    const name = componentNameFromReference(schema.$ref);
    if (name !== undefined) references.add(name);
  }
  for (const property of Object.values(schema.properties ?? {})) {
    collectReferences(property, references);
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    collectReferences(schema.additionalProperties, references);
  }
  if (schema.items !== undefined) collectReferences(schema.items, references);
  for (const child of [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ]) {
    collectReferences(child, references);
  }
  for (const reference of Object.values(schema.discriminator?.mapping ?? {})) {
    const name = componentNameFromReference(reference);
    if (name !== undefined) references.add(name);
  }
}

function assertSafeTypeName(name: string): void {
  if (
    name.length > 128 ||
    !SAFE_TYPE_NAME.test(name) ||
    RESERVED_NAMES.has(name.toLowerCase())
  ) {
    throw new Error(`unsafe OpenAPI component name: ${name}`);
  }
}

export function buildSchemaGraph(
  schemas: Readonly<Record<string, OpenApiSchema>>,
  rootNames?: ReadonlySet<string>
): readonly SchemaNode[] {
  const selectedNames = new Set<string>();
  const visit = (name: string, owner: string): void => {
    if (selectedNames.has(name)) return;
    const schema = schemas[name];
    if (schema === undefined) {
      throw new Error(
        `OpenAPI component ${owner} references missing component ${name}`
      );
    }
    selectedNames.add(name);
    const references = new Set<string>();
    collectReferences(schema, references);
    for (const reference of references) visit(reference, name);
  };
  for (const name of rootNames ?? new Set(Object.keys(schemas))) {
    visit(name, name);
  }
  const names = [...selectedNames].sort((left, right) =>
    left.localeCompare(right)
  );
  const caseFoldedFiles = new Map<string, string>();
  for (const name of names) {
    assertSafeTypeName(name);
    const fileName = `${name}.ts`;
    const folded = fileName.toLowerCase();
    const previous = caseFoldedFiles.get(folded);
    if (previous !== undefined) {
      throw new Error(
        `case-folded schema filename collision: ${previous} and ${fileName}`
      );
    }
    caseFoldedFiles.set(folded, fileName);
  }

  return names.map(name => {
    const schema = schemas[name];
    if (schema === undefined) {
      throw new Error(`schema graph lost component ${name}`);
    }
    const references = new Set<string>();
    collectReferences(schema, references);
    for (const reference of references) {
      if (!Object.hasOwn(schemas, reference)) {
        throw new Error(
          `OpenAPI component ${name} references missing component ${reference}`
        );
      }
    }
    return {
      name,
      fileName: `${name}.ts`,
      schema,
      references: [...references].sort((left, right) =>
        left.localeCompare(right)
      ),
    };
  });
}

function pascalCase(value: string): string {
  const pieces = value.match(/[A-Za-z]+|[0-9]+/g) ?? [];
  const result = pieces
    .map(piece => `${piece.charAt(0).toUpperCase()}${piece.slice(1)}`)
    .join("");
  if (!result || !SAFE_TYPE_NAME.test(result)) {
    throw new Error(`cannot allocate a safe generated type name from ${value}`);
  }
  return result;
}

export function allocateInlineTypeName(
  operationId: string,
  location: string
): string {
  return `${pascalCase(operationId)}${pascalCase(location)}`;
}

export function collectOperationSchemaRoots(
  operations: readonly SdkOperation[]
): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const operation of operations) {
    for (const parameter of operation.parameters) {
      collectReferences(parameter.schema, roots);
    }
    if (operation.requestBody !== undefined) {
      collectReferences(operation.requestBody.schema, roots);
    }
    for (const response of [
      ...operation.successResponses,
      ...operation.errorResponses,
    ]) {
      if (response.schema !== undefined)
        collectReferences(response.schema, roots);
    }
  }
  return roots;
}
