import type {
  OpenApiSchema,
  SdkOperation,
  SdkParameter,
  SdkResponse,
} from "./openapi-model";
import { GENERATED_HEADER, renderSchemaType } from "./type-renderer";

export interface RenderedProject {
  readonly generatedFiles: ReadonlyMap<string, string>;
  readonly editableFiles: ReadonlyMap<string, string>;
}

function pascalCase(value: string): string {
  const result = `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(result)) {
    throw new Error(`unsafe generated class name from ${value}`);
  }
  return result;
}

function referenceName(reference: string): string {
  return reference
    .slice("#/components/schemas/".length)
    .replaceAll("~1", "/")
    .replaceAll("~0", "~");
}

function collectReferences(
  schema: OpenApiSchema,
  references: Set<string>
): void {
  if (schema.$ref !== undefined) references.add(referenceName(schema.$ref));
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
}

function renderDoc(operation: SdkOperation, indentation: string): string {
  const lines = [
    ...(operation.summary?.split(/\r?\n/) ?? []),
    ...(operation.description?.split(/\r?\n/) ?? []),
    ...(operation.deprecated ? ["@deprecated"] : []),
  ];
  if (lines.length === 0) return "";
  return `${indentation}/**\n${lines
    .map(line => `${indentation} * ${line.replaceAll("*/", "*\\/")}`)
    .join("\n")}\n${indentation} */\n`;
}

function operationTypeName(operation: SdkOperation): string {
  return pascalCase(operation.operationId);
}

function sortedParameters(operation: SdkOperation): readonly SdkParameter[] {
  return [...operation.parameters].sort((left, right) => {
    const leftRank = left.location === "path" ? 0 : 1;
    const rightRank = right.location === "path" ? 0 : 1;
    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
}

function hasCallerParameters(operation: SdkOperation): boolean {
  return operation.parameters.length > 0 || operation.requestBody !== undefined;
}

function requiresParameterObject(operation: SdkOperation): boolean {
  return (
    operation.parameters.some(parameter => parameter.required) ||
    operation.requestBody?.required === true
  );
}

function renderParameterInterface(operation: SdkOperation): string {
  if (!hasCallerParameters(operation)) return "";
  const typeName = `${operationTypeName(operation)}Params`;
  const fields = sortedParameters(operation).map(parameter => {
    const optional = parameter.required ? "" : "?";
    return `  ${parameter.name}${optional}: ${renderSchemaType(parameter.schema, "  ")};`;
  });
  if (operation.requestBody !== undefined) {
    const optional = operation.requestBody.required ? "" : "?";
    fields.push(
      `  body${optional}: ${renderSchemaType(operation.requestBody.schema, "  ")};`
    );
  }
  return `export interface ${typeName} {\n${fields.join("\n")}\n}\n\n`;
}

function responseType(response: SdkResponse): string {
  if (response.mediaType === undefined) return "void";
  return response.schema === undefined
    ? response.mediaType === "text/plain"
      ? "string"
      : "unknown"
    : renderSchemaType(response.schema);
}

function returnType(operation: SdkOperation): string {
  return [...new Set(operation.successResponses.map(responseType))].join(" | ");
}

function renderQuerySerializer(operation: SdkOperation): string {
  const query = sortedParameters(operation).filter(
    parameter => parameter.location === "query"
  );
  if (query.length === 0) return "";
  const operationName = operationTypeName(operation);
  const entries = query
    .map(
      parameter => `    {
      name: ${JSON.stringify(parameter.name)},
      value: params.${parameter.name},
      style: ${JSON.stringify(parameter.style)},
      explode: ${String(parameter.explode)},
    },`
    )
    .join("\n");
  return `function serialize${operationName}Query(
  params: ${operationName}Params,
): readonly QueryParameter[] {
  return [
${entries}
  ];
}

`;
}

function renderMethod(operation: SdkOperation): string {
  const operationName = operationTypeName(operation);
  const hasParameters = hasCallerParameters(operation);
  const arguments_ = hasParameters
    ? `params: ${operationName}Params${requiresParameterObject(operation) ? "" : " = {}"},\n    options: RequestOptions = {}`
    : "options: RequestOptions = {}";
  const pathParameters = sortedParameters(operation).filter(
    parameter => parameter.location === "path"
  );
  const queryParameters = operation.parameters.filter(
    parameter => parameter.location === "query"
  );
  const successStatuses = operation.successResponses.map(
    response => response.status
  );
  const mediaTypes = [
    ...new Set(
      operation.successResponses.flatMap(response =>
        response.mediaType === undefined ? [] : [response.mediaType]
      )
    ),
  ];
  if (mediaTypes.length > 1) {
    throw new Error(
      `${operation.operationId} has incompatible successful response media types`
    );
  }
  const requestFields = [
    `operationId: ${JSON.stringify(operation.operationId)},`,
    `method: ${JSON.stringify(operation.httpMethod.toUpperCase())},`,
    `path: ${JSON.stringify(operation.path)},`,
  ];
  if (pathParameters.length > 0) {
    requestFields.push(
      `pathParameters: { ${pathParameters
        .map(parameter => `${parameter.name}: params.${parameter.name}`)
        .join(", ")} },`
    );
  }
  if (queryParameters.length > 0) {
    requestFields.push(`query: serialize${operationName}Query(params),`);
  }
  if (operation.requestBody !== undefined) {
    requestFields.push("body: params.body,");
    requestFields.push(
      `requestMediaType: ${JSON.stringify(operation.requestBody.mediaType)},`
    );
  }
  requestFields.push(`successStatuses: ${JSON.stringify(successStatuses)},`);
  if (mediaTypes[0] !== undefined) {
    requestFields.push(`responseMediaType: ${JSON.stringify(mediaTypes[0])},`);
  }
  const signature = hasParameters
    ? `  async ${operation.methodName}(\n    ${arguments_},\n  ): Promise<${returnType(operation)}>`
    : `  async ${operation.methodName}(${arguments_}): Promise<${returnType(operation)}>`;
  return `${renderDoc(operation, "  ")}${signature} {
    return this.transport.request<${returnType(operation)}>(
      {
        ${requestFields.join("\n        ")}
      },
      options,
    );
  }
`;
}

function renderResource(
  namespace: string,
  operations: readonly SdkOperation[]
): string {
  const resourceKind = operations[0]?.resourceKind;
  if (
    resourceKind === undefined ||
    operations.some(operation => operation.resourceKind !== resourceKind)
  ) {
    throw new Error(`inconsistent resource kind for namespace ${namespace}`);
  }
  const isDocument = resourceKind === "document";
  const className = pascalCase(namespace);
  const references = new Set<string>();
  for (const operation of operations) {
    for (const parameter of operation.parameters) {
      collectReferences(parameter.schema, references);
    }
    if (operation.requestBody !== undefined) {
      collectReferences(operation.requestBody.schema, references);
    }
    for (const response of operation.successResponses) {
      if (response.schema !== undefined)
        collectReferences(response.schema, references);
    }
  }
  const dtoImports = [...references]
    .sort((left, right) => left.localeCompare(right))
    .map(
      reference =>
        `import type { ${reference} } from "../../../generated/dto/${reference}";`
    )
    .join("\n");
  const usesQuery = operations.some(operation =>
    operation.parameters.some(parameter => parameter.location === "query")
  );
  const transportTypes = usesQuery
    ? 'import type { QueryParameter, SdkRuntimeTransport } from "../../../transport/transport";'
    : 'import type { SdkRuntimeTransport } from "../../../transport/transport";';
  const imports = `import type { RequestOptions } from "../../../transport/request-options";\n${
    isDocument
      ? 'import type { ControlOptions } from "../../../controls/ui";\n'
      : ""
  }${transportTypes}${dtoImports ? `\n${dtoImports}` : ""}`;
  const types = operations.map(renderParameterInterface).join("");
  const serializers = operations.map(renderQuerySerializer).join("");
  const methods = operations.map(renderMethod).join("\n");
  const formMethod = isDocument
    ? `  /**
   * Opens this resource's SimTrain on-screen form.
   *
   * Omit \`id\` to add a record, or provide an existing record ID to edit it.
   */
  openOnScreenForm(id?: string, options: ControlOptions = {}): Promise<void> {
    return this.transport.openOnScreenForm(${JSON.stringify(namespace)}, id, options);
  }

`
    : "";
  return `${GENERATED_HEADER}\n${imports}\n\n${types}${serializers}export class ${className}Base {
  constructor(protected readonly transport: SdkRuntimeTransport) {}

${formMethod}${methods}}
`;
}

function renderSdkBase(namespaces: readonly string[]): string {
  const imports = namespaces
    .map(namespace => {
      const name = pascalCase(namespace);
      return `import { ${name} } from "../resources/${namespace}/${namespace}";`;
    })
    .join("\n");
  const properties = namespaces
    .map(namespace => `  readonly ${namespace}: ${pascalCase(namespace)};`)
    .join("\n");
  const assignments = namespaces
    .map(
      namespace =>
        `    this.${namespace} = new ${pascalCase(namespace)}(transport);`
    )
    .join("\n");
  return `${GENERATED_HEADER}\nimport type { SdkRuntimeTransport } from "../transport/transport";\n${imports}\n\nexport abstract class SimTrainSdkBase {
${properties}

  protected constructor(transport: SdkRuntimeTransport) {
${assignments}
  }
}
`;
}

export function renderOperationProject(
  operations: readonly SdkOperation[]
): RenderedProject {
  const generatedFiles = new Map<string, string>();
  const editableFiles = new Map<string, string>();
  const groups = new Map<string, SdkOperation[]>();
  for (const operation of operations) {
    const group = groups.get(operation.namespace) ?? [];
    group.push(operation);
    groups.set(operation.namespace, group);
  }
  const namespaces = [...groups.keys()].sort((left, right) =>
    left.localeCompare(right)
  );
  const foldedNamespaces = new Set<string>();
  for (const namespace of namespaces) {
    const folded = namespace.toLowerCase();
    if (foldedNamespaces.has(folded)) {
      throw new Error(`case-folded resource directory collision: ${namespace}`);
    }
    foldedNamespaces.add(folded);
    const group = groups.get(namespace);
    if (group === undefined)
      throw new Error(`missing operation group ${namespace}`);
    group.sort((left, right) =>
      left.methodName.localeCompare(right.methodName)
    );
    const className = pascalCase(namespace);
    const basePath = `src/resources/${namespace}/generated/${namespace}.base.ts`;
    generatedFiles.set(basePath, renderResource(namespace, group));
    generatedFiles.set(
      `src/resources/${namespace}/generated/index.ts`,
      `${GENERATED_HEADER}\nexport { ${className}Base } from "./${namespace}.base";\n${group
        .filter(hasCallerParameters)
        .map(
          operation =>
            `export type { ${operationTypeName(operation)}Params } from "./${namespace}.base";`
        )
        .join("\n")}\n`
    );
    editableFiles.set(
      `src/resources/${namespace}/${namespace}.ts`,
      `import { ${className}Base } from "./generated";\n\nexport class ${className} extends ${className}Base {}\n`
    );
  }
  generatedFiles.set("src/generated/sdk.base.ts", renderSdkBase(namespaces));
  const parameterExports = namespaces
    .flatMap(namespace => {
      const group = groups.get(namespace);
      if (group === undefined)
        throw new Error(`missing operation group ${namespace}`);
      return group
        .filter(hasCallerParameters)
        .map(
          operation =>
            `export type { ${operationTypeName(operation)}Params } from "../resources/${namespace}/generated";`
        );
    })
    .join("\n");
  generatedFiles.set(
    "src/generated/index.ts",
    `${GENERATED_HEADER}\nexport type * from "./dto";${parameterExports ? `\n${parameterExports}` : ""}\n`
  );
  return { generatedFiles, editableFiles };
}
