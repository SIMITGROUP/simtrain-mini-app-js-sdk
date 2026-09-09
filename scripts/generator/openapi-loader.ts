import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type {
  JsonValue,
  LoadedSdkContract,
  OpenApiDiscriminator,
  OpenApiSchema,
  SdkOperation,
  SdkParameter,
  SdkRequestBody,
  SdkResponse,
} from "./openapi-model";

type UnknownRecord = Record<string, unknown>;

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCHEMA_KEYS = new Set([
  "$ref",
  "type",
  "format",
  "title",
  "description",
  "deprecated",
  "nullable",
  "readOnly",
  "writeOnly",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "allOf",
  "oneOf",
  "anyOf",
  "discriminator",
  "enum",
  "default",
  "example",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "pattern",
]);

function fail(location: string, message: string): never {
  throw new Error(`${message} at ${location}`);
}

function record(value: unknown, location: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(location, "expected an object");
  }
  return value as UnknownRecord;
}

function array(value: unknown, location: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(location, "expected an array");
  }
  return value;
}

function string(value: unknown, location: string): string {
  if (typeof value !== "string" || !value) {
    fail(location, "expected a non-empty string");
  }
  return value;
}

function boolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") {
    fail(location, "expected a boolean");
  }
  return value;
}

function number(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(location, "expected a finite number");
  }
  return value;
}

function optionalString(
  object: UnknownRecord,
  key: string,
  location: string
): string | undefined {
  return object[key] === undefined
    ? undefined
    : string(object[key], `${location}.${key}`);
}

function optionalText(
  object: UnknownRecord,
  key: string,
  location: string
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    fail(`${location}.${key}`, "expected a string");
  }
  return value;
}

function optionalBoolean(
  object: UnknownRecord,
  key: string,
  location: string
): boolean | undefined {
  return object[key] === undefined
    ? undefined
    : boolean(object[key], `${location}.${key}`);
}

function assertAllowedKeys(
  object: UnknownRecord,
  allowed: ReadonlySet<string>,
  location: string
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      fail(`${location}.${key}`, "unsupported OpenAPI field");
    }
  }
}

function jsonValue(value: unknown, location: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(location, "JSON number must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      jsonValue(item, `${location}.${String(index)}`)
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, `${location}.${key}`),
      ])
    );
  }
  fail(location, "value is not JSON-compatible");
}

function stringArray(value: unknown, location: string): readonly string[] {
  return array(value, location).map((item, index) =>
    string(item, `${location}.${String(index)}`)
  );
}

function parseDiscriminator(
  value: unknown,
  location: string
): OpenApiDiscriminator {
  const object = record(value, location);
  assertAllowedKeys(object, new Set(["propertyName", "mapping"]), location);
  const propertyName = string(object.propertyName, `${location}.propertyName`);
  if (object.mapping === undefined) {
    return { propertyName };
  }
  const mappingObject = record(object.mapping, `${location}.mapping`);
  const mapping = Object.fromEntries(
    Object.entries(mappingObject).map(([key, target]) => {
      const reference = string(target, `${location}.mapping.${key}`);
      if (!reference.startsWith("#/components/schemas/")) {
        fail(`${location}.mapping.${key}`, "external discriminator reference");
      }
      return [key, reference];
    })
  );
  return { propertyName, mapping };
}

function parseSchema(value: unknown, location: string): OpenApiSchema {
  const object = record(value, location);
  assertAllowedKeys(object, SCHEMA_KEYS, location);
  const result: {
    -readonly [Key in keyof OpenApiSchema]?: OpenApiSchema[Key];
  } = {};

  if (object.$ref !== undefined) {
    const reference = string(object.$ref, `${location}.$ref`);
    if (!reference.startsWith("#/components/schemas/")) {
      fail(location, "schema $ref must target #/components/schemas");
    }
    result.$ref = reference;
  }
  if (object.type !== undefined) {
    const type = string(object.type, `${location}.type`);
    if (
      !["object", "array", "string", "number", "integer", "boolean"].includes(
        type
      )
    ) {
      fail(`${location}.type`, `unsupported schema type ${type}`);
    }
    result.type = type as NonNullable<OpenApiSchema["type"]>;
  }
  for (const key of ["format", "description", "pattern"] as const) {
    if (object[key] !== undefined) {
      result[key] = string(object[key], `${location}.${key}`);
    }
  }
  for (const key of [
    "deprecated",
    "nullable",
    "readOnly",
    "writeOnly",
    "uniqueItems",
  ] as const) {
    if (object[key] !== undefined) {
      result[key] = boolean(object[key], `${location}.${key}`);
    }
  }
  for (const key of [
    "minimum",
    "maximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ] as const) {
    if (object[key] !== undefined) {
      result[key] = number(object[key], `${location}.${key}`);
    }
  }
  for (const key of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
    if (object[key] !== undefined) {
      result[key] =
        typeof object[key] === "boolean"
          ? boolean(object[key], `${location}.${key}`)
          : number(object[key], `${location}.${key}`);
    }
  }
  if (object.required !== undefined) {
    result.required = stringArray(object.required, `${location}.required`);
  }
  if (object.properties !== undefined) {
    result.properties = Object.fromEntries(
      Object.entries(record(object.properties, `${location}.properties`)).map(
        ([name, schema]) => [
          name,
          parseSchema(schema, `${location}.properties.${name}`),
        ]
      )
    );
  }
  if (object.additionalProperties !== undefined) {
    result.additionalProperties =
      typeof object.additionalProperties === "boolean"
        ? object.additionalProperties
        : parseSchema(
            object.additionalProperties,
            `${location}.additionalProperties`
          );
  }
  if (object.items !== undefined) {
    result.items = parseSchema(object.items, `${location}.items`);
  }
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    if (object[key] !== undefined) {
      result[key] = array(object[key], `${location}.${key}`).map(
        (schema, index) =>
          parseSchema(schema, `${location}.${key}.${String(index)}`)
      );
    }
  }
  if (object.discriminator !== undefined) {
    result.discriminator = parseDiscriminator(
      object.discriminator,
      `${location}.discriminator`
    );
  }
  if (object.enum !== undefined) {
    result.enum = array(object.enum, `${location}.enum`).map((item, index) =>
      jsonValue(item, `${location}.enum.${String(index)}`)
    );
  }
  for (const key of ["default", "example"] as const) {
    if (object[key] !== undefined) {
      result[key] = jsonValue(object[key], `${location}.${key}`);
    }
  }
  return result;
}

function assertLocalReferences(
  value: unknown,
  root: UnknownRecord,
  location = "document"
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertLocalReferences(item, root, `${location}.${String(index)}`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (key === "$ref") {
      const reference = string(child, childLocation);
      if (!reference.startsWith("#/")) {
        fail(location, "external $ref is not allowed");
      }
      let target: unknown = root;
      for (const encodedPart of reference.slice(2).split("/")) {
        const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
        const targetObject = record(target, childLocation);
        if (!Object.hasOwn(targetObject, part)) {
          fail(childLocation, `unresolved local $ref ${reference}`);
        }
        target = targetObject[part];
      }
    } else {
      assertLocalReferences(child, root, childLocation);
    }
  }
}

function assertSafeIdentifier(value: unknown, location: string): string {
  const identifier = string(value, location);
  if (
    identifier.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9]*$/.test(identifier) ||
    RESERVED_KEYS.has(identifier.toLowerCase())
  ) {
    fail(location, `unsafe SDK identifier ${identifier}`);
  }
  return identifier;
}

function assertSafePath(path: string): void {
  const location = `paths.${path}`;
  if (!path.startsWith("/v2/") || /[\\?#\0]/.test(path)) {
    fail(location, "unsafe SDK path");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    fail(location, "unsafe percent encoding in SDK path");
  }
  if (/[\\?#\0]/.test(decoded)) {
    fail(location, "unsafe decoded SDK path");
  }
  const segments = decoded.split("/");
  if (
    segments.some(
      segment => segment === "." || segment === ".." || segment.includes("/")
    )
  ) {
    fail(location, "unsafe traversal in SDK path");
  }
  for (const placeholder of path.matchAll(/\{([^}]*)\}/g)) {
    assertSafeIdentifier(placeholder[1], `${location}.parameter`);
  }
  if (path.replaceAll(/\{[A-Za-z][A-Za-z0-9]*\}/g, "").match(/[{}]/)) {
    fail(location, "malformed SDK path parameter");
  }
}

function assertSecuritySchemes(document: UnknownRecord): void {
  const components = record(document.components, "components");
  const schemes = record(
    components.securitySchemes,
    "components.securitySchemes"
  );
  const expected: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    serviceBearer: { type: "http", scheme: "bearer" },
    miniAppUserBearer: { type: "http", scheme: "bearer" },
    "x-org": { type: "apiKey", in: "header", name: "x-org" },
  };
  for (const [name, fields] of Object.entries(expected)) {
    const location = `components.securitySchemes.${name}`;
    const scheme = record(schemes[name], location);
    for (const [key, expectedValue] of Object.entries(fields)) {
      if (scheme[key] !== expectedValue) {
        fail(`${location}.${key}`, `expected ${expectedValue}`);
      }
    }
    if (scheme["x-sdk-managed"] !== true) {
      fail(`${location}.x-sdk-managed`, "security scheme must be SDK-managed");
    }
  }
}

function assertBrowserSecurity(value: unknown, location: string): void {
  const alternatives = array(value, location);
  if (alternatives.length !== 2) {
    fail(
      location,
      "browser security must have exactly two bearer alternatives"
    );
  }
  const keys = alternatives.map((alternative, index) => {
    const object = record(alternative, `${location}.${String(index)}`);
    for (const [name, scopes] of Object.entries(object)) {
      if (array(scopes, `${location}.${String(index)}.${name}`).length !== 0) {
        fail(location, "browser security scopes must be empty");
      }
    }
    return Object.keys(object).sort().join("+");
  });
  const expected = ["miniAppUserBearer", "serviceBearer+x-org"];
  if (keys.sort().join("|") !== expected.join("|")) {
    fail(
      location,
      "browser security must require x-org only with the service bearer"
    );
  }
}

function parseParameter(value: unknown, location: string): SdkParameter {
  const object = record(value, location);
  assertAllowedKeys(
    object,
    new Set([
      "name",
      "in",
      "required",
      "description",
      "style",
      "explode",
      "schema",
    ]),
    location
  );
  const name = string(object.name, `${location}.name`);
  const parameterLocation = string(object.in, `${location}.in`);
  if (parameterLocation !== "path" && parameterLocation !== "query") {
    fail(
      `${location}.in`,
      "browser SDK only supports path and query parameters"
    );
  }
  const required =
    object.required === undefined
      ? false
      : boolean(object.required, `${location}.required`);
  if (parameterLocation === "path" && !required) {
    fail(`${location}.required`, "path parameters must be required");
  }
  const defaultStyle = parameterLocation === "path" ? "simple" : "form";
  const style =
    object.style === undefined
      ? defaultStyle
      : string(object.style, `${location}.style`);
  if (style !== defaultStyle) {
    fail(
      `${location}.style`,
      `unsupported ${parameterLocation} parameter style`
    );
  }
  const explode =
    object.explode === undefined
      ? parameterLocation === "query"
      : boolean(object.explode, `${location}.explode`);
  if (explode !== (parameterLocation === "query")) {
    fail(`${location}.explode`, "unsupported parameter explode setting");
  }
  const description = optionalString(object, "description", location);
  return {
    name,
    location: parameterLocation,
    required,
    style,
    explode,
    ...(description === undefined ? {} : { description }),
    schema: parseSchema(object.schema, `${location}.schema`),
  };
}

function parseRequestBody(value: unknown, location: string): SdkRequestBody {
  const object = record(value, location);
  assertAllowedKeys(
    object,
    new Set(["required", "description", "content"]),
    location
  );
  const content = record(object.content, `${location}.content`);
  if (
    Object.keys(content).length !== 1 ||
    !Object.hasOwn(content, "application/json")
  ) {
    fail(
      `${location}.content`,
      `${location}.content must use only application/json`
    );
  }
  const media = record(
    content["application/json"],
    `${location}.content.application/json`
  );
  assertAllowedKeys(
    media,
    new Set(["schema"]),
    `${location}.content.application/json`
  );
  return {
    required:
      object.required === undefined
        ? false
        : boolean(object.required, `${location}.required`),
    mediaType: "application/json",
    schema: parseSchema(
      media.schema,
      `${location}.content.application/json.schema`
    ),
  };
}

function parseResponse(
  statusText: string,
  value: unknown,
  location: string
): SdkResponse {
  const object = record(value, location);
  assertAllowedKeys(
    object,
    new Set(["description", "headers", "content"]),
    location
  );
  if (object.headers !== undefined) {
    fail(
      `${location}.headers`,
      "response headers are not supported by the SDK generator"
    );
  }
  const description = optionalText(object, "description", location);
  const status: number | "default" =
    statusText === "default"
      ? "default"
      : /^\d{3}$/.test(statusText)
        ? Number(statusText)
        : fail(location, `unsupported response status ${statusText}`);
  if (
    status !== "default" &&
    (status < 200 || (status >= 300 && status < 400))
  ) {
    fail(location, `unsupported response status ${statusText}`);
  }
  if (object.content === undefined) {
    return {
      status,
      ...(description === undefined ? {} : { description }),
    };
  }
  const content = record(object.content, `${location}.content`);
  const mediaTypes = Object.keys(content);
  if (
    mediaTypes.length !== 1 ||
    (mediaTypes[0] !== "application/json" && mediaTypes[0] !== "text/plain")
  ) {
    fail(
      `${location}.content`,
      "response must use application/json or text/plain only"
    );
  }
  const mediaType = mediaTypes[0];
  const media = record(content[mediaType], `${location}.content.${mediaType}`);
  assertAllowedKeys(
    media,
    new Set(["schema"]),
    `${location}.content.${mediaType}`
  );
  return {
    status,
    mediaType,
    ...(media.schema === undefined
      ? {}
      : {
          schema: parseSchema(
            media.schema,
            `${location}.content.${mediaType}.schema`
          ),
        }),
    ...(description === undefined ? {} : { description }),
  };
}

function parseBrowserOperation(
  operation: UnknownRecord,
  effectiveSecurity: unknown,
  path: string,
  method: (typeof HTTP_METHODS)[number],
  namespace: string,
  methodName: string,
  resourceKind: SdkOperation["resourceKind"]
): SdkOperation {
  const location = `paths.${path}.${method}`;
  assertBrowserSecurity(effectiveSecurity, `${location}.security`);
  const parameterValues =
    operation.parameters === undefined
      ? []
      : array(operation.parameters, `${location}.parameters`);
  const parameters = parameterValues.map((parameter, index) =>
    parseParameter(parameter, `${location}.parameters.${String(index)}`)
  );
  const parameterKeys = new Set<string>();
  for (const parameter of parameters) {
    const key = `${parameter.location}:${parameter.name}`;
    if (parameterKeys.has(key)) {
      fail(`${location}.parameters`, `duplicate parameter ${key}`);
    }
    parameterKeys.add(key);
  }
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].flatMap(match =>
    match[1] === undefined ? [] : [match[1]]
  );
  for (const placeholder of placeholders) {
    if (
      !parameters.some(
        item => item.location === "path" && item.name === placeholder
      )
    ) {
      fail(`${location}.parameters`, `missing path parameter ${placeholder}`);
    }
  }
  if (
    parameters.some(
      item => item.location === "path" && !placeholders.includes(item.name)
    )
  ) {
    fail(
      `${location}.parameters`,
      "declares a path parameter absent from the path"
    );
  }

  const responsesObject = record(operation.responses, `${location}.responses`);
  const responses = Object.entries(responsesObject).map(([status, response]) =>
    parseResponse(status, response, `${location}.responses.${status}`)
  );
  const successResponses = responses.filter(
    response =>
      typeof response.status === "number" &&
      response.status >= 200 &&
      response.status < 300
  );
  if (successResponses.length === 0) {
    fail(`${location}.responses`, "browser operation has no 2xx response");
  }
  const errorResponses = responses.filter(response =>
    response.status === "default"
      ? true
      : response.status >= 400 && response.status < 600
  );
  const summary = optionalString(operation, "summary", location);
  const description = optionalString(operation, "description", location);
  const requestBody =
    operation.requestBody === undefined
      ? undefined
      : parseRequestBody(operation.requestBody, `${location}.requestBody`);

  return {
    operationId: assertSafeIdentifier(
      operation.operationId,
      `${location}.operationId`
    ),
    namespace,
    methodName,
    resourceKind,
    httpMethod: method,
    path,
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    deprecated: optionalBoolean(operation, "deprecated", location) ?? false,
    parameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    successResponses,
    errorResponses,
  };
}

function loadDocument(text: string, sourceName: string): UnknownRecord {
  let parsed: unknown;
  try {
    parsed = parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot parse OpenAPI contract ${sourceName}: ${message}`);
  }
  return record(parsed, sourceName);
}

export function loadSdkContractFromText(
  text: string,
  sourceName = "openapi-v2.yaml"
): LoadedSdkContract {
  const document = loadDocument(text, sourceName);
  const openapi = string(document.openapi, "openapi");
  if (!/^3\.0\.\d+$/.test(openapi)) {
    fail("openapi", `unsupported OpenAPI version ${openapi}`);
  }
  assertLocalReferences(document, document);
  assertSecuritySchemes(document);

  const components = record(document.components, "components");
  const schemaObjects = record(components.schemas, "components.schemas");
  const schemas = Object.fromEntries(
    Object.entries(schemaObjects).map(([name, schema]) => [
      name,
      parseSchema(schema, `components.schemas.${name}`),
    ])
  );

  const paths = record(document.paths, "paths");
  const rootSecurity = document.security;
  const operations: SdkOperation[] = [];
  const operationIds = new Set<string>();
  const sdkMethods = new Set<string>();
  const resourceKinds = new Map<string, SdkOperation["resourceKind"]>();
  for (const [path, pathValue] of Object.entries(paths)) {
    assertSafePath(path);
    const pathItem = record(pathValue, `paths.${path}`);
    for (const key of Object.keys(pathItem)) {
      if (!HTTP_METHODS.includes(key as (typeof HTTP_METHODS)[number])) {
        fail(`paths.${path}.${key}`, "unsupported path item field");
      }
    }
    for (const method of HTTP_METHODS) {
      if (pathItem[method] === undefined) continue;
      const location = `paths.${path}.${method}`;
      const operation = record(pathItem[method], location);
      const operationId = assertSafeIdentifier(
        operation.operationId,
        `${location}.operationId`
      );
      if (operationIds.has(operationId.toLowerCase())) {
        fail(`${location}.operationId`, `operationId collision ${operationId}`);
      }
      operationIds.add(operationId.toLowerCase());
      const namespace = assertSafeIdentifier(
        operation["x-sdk-namespace"],
        `${location}.x-sdk-namespace`
      );
      const methodName = assertSafeIdentifier(
        operation["x-sdk-method"],
        `${location}.x-sdk-method`
      );
      const visibility = string(
        operation["x-sdk-visibility"],
        `${location}.x-sdk-visibility`
      );
      if (visibility !== "browser" && visibility !== "server") {
        fail(
          `${location}.x-sdk-visibility`,
          `unsupported visibility ${visibility}`
        );
      }
      const resourceKindValue = string(
        operation["x-sdk-resource-kind"],
        `${location}.x-sdk-resource-kind`
      );
      if (
        resourceKindValue !== "document" &&
        resourceKindValue !== "context" &&
        resourceKindValue !== "infrastructure"
      ) {
        fail(
          `${location}.x-sdk-resource-kind`,
          `unsupported resource kind ${resourceKindValue}`
        );
      }
      if (visibility === "server") {
        continue;
      }
      if (resourceKindValue === "infrastructure") {
        fail(
          `${location}.x-sdk-resource-kind`,
          "browser operations cannot be infrastructure resources"
        );
      }
      const resourceKey = namespace.toLocaleLowerCase("en-US");
      const existingResourceKind = resourceKinds.get(resourceKey);
      if (
        existingResourceKind !== undefined &&
        existingResourceKind !== resourceKindValue
      ) {
        fail(
          `${location}.x-sdk-resource-kind`,
          `inconsistent resource kind for namespace ${namespace}`
        );
      }
      resourceKinds.set(resourceKey, resourceKindValue);
      const sdkMethod = `${namespace}.${methodName}`.toLowerCase();
      if (sdkMethods.has(sdkMethod)) {
        fail(location, `SDK method collision ${namespace}.${methodName}`);
      }
      sdkMethods.add(sdkMethod);
      operations.push(
        parseBrowserOperation(
          operation,
          operation.security ?? rootSecurity,
          path,
          method,
          namespace,
          methodName,
          resourceKindValue
        )
      );
    }
  }
  return { openapi, operations, schemas };
}

export function loadSdkContract(path: string): LoadedSdkContract {
  return loadSdkContractFromText(readFileSync(path, "utf8"), path);
}
