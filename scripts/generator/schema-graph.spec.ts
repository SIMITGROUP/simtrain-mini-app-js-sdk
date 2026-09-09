import type { OpenApiSchema, SdkOperation } from "./openapi-model";
import {
  allocateInlineTypeName,
  buildSchemaGraph,
  collectOperationSchemaRoots,
} from "./schema-graph";

describe("buildSchemaGraph", () => {
  it("sorts nodes and records recursive component references", () => {
    const schemas: Readonly<Record<string, OpenApiSchema>> = {
      User: {
        type: "object",
        properties: {
          manager: { $ref: "#/components/schemas/User" },
          team: {
            type: "array",
            items: { $ref: "#/components/schemas/Team" },
          },
        },
      },
      Team: { type: "object" },
    };

    const graph = buildSchemaGraph(schemas);

    expect(graph.map(node => node.name)).toEqual(["Team", "User"]);
    expect(graph[1]?.references).toEqual(["Team", "User"]);
    expect(graph[1]?.fileName).toBe("User.ts");
  });

  it("rejects missing references and case-folded output collisions", () => {
    expect(() =>
      buildSchemaGraph({ Broken: { $ref: "#/components/schemas/Missing" } })
    ).toThrow(/Broken.*Missing/);
    expect(() =>
      buildSchemaGraph({ User: { type: "string" }, user: { type: "string" } })
    ).toThrow(/case-folded.*User\.ts.*user\.ts/i);
  });

  it("includes only schemas transitively reachable from browser operations", () => {
    const operation: SdkOperation = {
      operationId: "getPublic",
      namespace: "public",
      methodName: "get",
      resourceKind: "context",
      httpMethod: "get",
      path: "/v2/public",
      deprecated: false,
      parameters: [],
      successResponses: [
        {
          status: 200,
          mediaType: "application/json",
          schema: { $ref: "#/components/schemas/PublicResponse" },
        },
      ],
      errorResponses: [],
    };
    const schemas: Readonly<Record<string, OpenApiSchema>> = {
      PublicResponse: { $ref: "#/components/schemas/Shared" },
      Shared: { type: "string" },
      DevAuthDto: {
        type: "object",
        properties: { clientSecret: { type: "string" } },
      },
    };

    const graph = buildSchemaGraph(
      schemas,
      collectOperationSchemaRoots([operation])
    );

    expect(graph.map(node => node.name)).toEqual(["PublicResponse", "Shared"]);
  });
});

describe("allocateInlineTypeName", () => {
  it("uses only the operation ID and schema location", () => {
    expect(allocateInlineTypeName("listStudents", "response.200")).toBe(
      "ListStudentsResponse200"
    );
    expect(allocateInlineTypeName("patchStudent", "request.body")).toBe(
      "PatchStudentRequestBody"
    );
  });
});
