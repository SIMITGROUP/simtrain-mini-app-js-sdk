export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface OpenApiDiscriminator {
  readonly propertyName: string;
  readonly mapping?: Readonly<Record<string, string>>;
}

export interface OpenApiSchema {
  readonly $ref?: string;
  readonly type?:
    "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly format?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly nullable?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, OpenApiSchema>>;
  readonly additionalProperties?: boolean | OpenApiSchema;
  readonly items?: OpenApiSchema;
  readonly allOf?: readonly OpenApiSchema[];
  readonly oneOf?: readonly OpenApiSchema[];
  readonly anyOf?: readonly OpenApiSchema[];
  readonly discriminator?: OpenApiDiscriminator;
  readonly enum?: readonly JsonValue[];
  readonly default?: JsonValue;
  readonly example?: JsonValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: boolean | number;
  readonly exclusiveMaximum?: boolean | number;
  readonly multipleOf?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly minProperties?: number;
  readonly maxProperties?: number;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly pattern?: string;
}

export type SdkParameterLocation = "path" | "query";
export type SdkResourceKind = "document" | "context";

export interface SdkParameter {
  readonly name: string;
  readonly location: SdkParameterLocation;
  readonly required: boolean;
  readonly style: "form" | "simple";
  readonly explode: boolean;
  readonly description?: string;
  readonly schema: OpenApiSchema;
}

export interface SdkRequestBody {
  readonly required: boolean;
  readonly mediaType: "application/json";
  readonly schema: OpenApiSchema;
}

export interface SdkResponse {
  readonly status: number | "default";
  readonly mediaType?: "application/json" | "text/plain";
  readonly schema?: OpenApiSchema;
  readonly description?: string;
}

export interface SdkOperation {
  readonly operationId: string;
  readonly namespace: string;
  readonly methodName: string;
  readonly resourceKind: SdkResourceKind;
  readonly httpMethod: "get" | "post" | "patch" | "put" | "delete";
  readonly path: string;
  readonly summary?: string;
  readonly description?: string;
  readonly deprecated: boolean;
  readonly parameters: readonly SdkParameter[];
  readonly requestBody?: SdkRequestBody;
  readonly successResponses: readonly SdkResponse[];
  readonly errorResponses: readonly SdkResponse[];
}

export interface LoadedSdkContract {
  readonly openapi: string;
  readonly operations: readonly SdkOperation[];
  readonly schemas: Readonly<Record<string, OpenApiSchema>>;
}
