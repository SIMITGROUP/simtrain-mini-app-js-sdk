import type { OpenApiSchema, SdkOperation } from "./openapi-model";
import { renderOperationProject } from "./operation-renderer";

const json = (schema: OpenApiSchema, status = 200) => ({
  status,
  mediaType: "application/json" as const,
  schema,
});

function operation(overrides: Partial<SdkOperation> = {}): SdkOperation {
  return {
    operationId: "listWidgets",
    namespace: "widgets",
    methodName: "list",
    resourceKind: "document",
    httpMethod: "get",
    path: "/v2/widgets",
    deprecated: false,
    parameters: [],
    successResponses: [json({ $ref: "#/components/schemas/WidgetList" })],
    errorResponses: [],
    ...overrides,
  };
}

describe("renderOperationProject", () => {
  it("renders a truly parameterless method with only RequestOptions", () => {
    const project = renderOperationProject([operation()]);
    const resource = project.generatedFiles.get(
      "src/resources/widgets/generated/widgets.base.ts"
    );

    expect(resource).toContain(
      "async list(options: RequestOptions = {}): Promise<WidgetList>"
    );
    expect(resource).toContain('operationId: "listWidgets"');
    expect(resource).toContain('method: "GET"');
    expect(resource).toContain('path: "/v2/widgets"');
    expect(resource).toContain("successStatuses: [200]");
    expect(resource).toContain('responseMediaType: "application/json"');
  });

  it("renders typed path, exploded query, nullable query, and JSON body inputs", () => {
    const project = renderOperationProject([
      operation({
        operationId: "updateWidget",
        methodName: "update",
        httpMethod: "patch",
        path: "/v2/widgets/{id}",
        parameters: [
          {
            name: "id",
            location: "path",
            required: true,
            style: "simple",
            explode: false,
            schema: { type: "string" },
          },
          {
            name: "tag",
            location: "query",
            required: false,
            style: "form",
            explode: true,
            schema: { type: "array", items: { type: "string" } },
          },
          {
            name: "note",
            location: "query",
            required: false,
            style: "form",
            explode: true,
            schema: { type: "string", nullable: true },
          },
        ],
        requestBody: {
          required: true,
          mediaType: "application/json",
          schema: { $ref: "#/components/schemas/WidgetPatch" },
        },
        successResponses: [json({ $ref: "#/components/schemas/Widget" })],
      }),
    ]);
    const resource = project.generatedFiles.get(
      "src/resources/widgets/generated/widgets.base.ts"
    );

    expect(resource).toContain("export interface UpdateWidgetParams");
    expect(resource).toContain("id: string;");
    expect(resource).toContain("tag?: string[];");
    expect(resource).toContain("note?: string | null;");
    expect(resource).toContain("body: WidgetPatch;");
    expect(resource).toContain("pathParameters: { id: params.id }");
    expect(resource).toContain("query: serializeUpdateWidgetQuery(params)");
    expect(resource).toContain('name: "tag"');
    expect(resource).toContain("explode: true");
    expect(resource).toContain("body: params.body");
    expect(resource).toContain('requestMediaType: "application/json"');
  });

  it("renders empty, JSON, and text responses plus deprecation documentation", () => {
    const project = renderOperationProject([
      operation({
        operationId: "deleteWidget",
        methodName: "delete",
        httpMethod: "delete",
        path: "/v2/widgets/{id}",
        deprecated: true,
        summary: "Delete one widget.",
        parameters: [
          {
            name: "id",
            location: "path",
            required: true,
            style: "simple",
            explode: false,
            schema: { type: "string" },
          },
        ],
        successResponses: [{ status: 204 }],
      }),
      operation({
        operationId: "exportWidgets",
        methodName: "export",
        successResponses: [
          { status: 200, mediaType: "text/plain", schema: { type: "string" } },
        ],
      }),
    ]);
    const resource = project.generatedFiles.get(
      "src/resources/widgets/generated/widgets.base.ts"
    );

    expect(resource).toContain("@deprecated");
    expect(resource).toContain("Delete one widget.");
    expect(resource).toContain("Promise<void>");
    expect(resource).toContain('responseMediaType: "text/plain"');
    expect(resource).toContain("Promise<string>");
  });

  it("creates generated roots and create-once editable subclasses", () => {
    const project = renderOperationProject([
      operation({
        operationId: "updateWidget",
        methodName: "update",
        parameters: [
          {
            name: "id",
            location: "path",
            required: true,
            style: "simple",
            explode: false,
            schema: { type: "string" },
          },
        ],
      }),
    ]);

    expect(project.generatedFiles.has("src/generated/sdk.base.ts")).toBe(true);
    expect(project.generatedFiles.has("src/generated/index.ts")).toBe(true);
    expect(
      project.generatedFiles.has("src/resources/widgets/generated/index.ts")
    ).toBe(true);
    expect(
      project.editableFiles.get("src/resources/widgets/widgets.ts")
    ).toContain("export class Widgets extends WidgetsBase");
    expect(project.generatedFiles.get("src/generated/index.ts")).toContain(
      'export type { UpdateWidgetParams } from "../resources/widgets/generated";'
    );
  });

  it("adds forms only to document resources and embeds the namespace", () => {
    const documentProject = renderOperationProject([operation()]);
    const documentResource = documentProject.generatedFiles.get(
      "src/resources/widgets/generated/widgets.base.ts"
    );
    expect(documentResource).toContain(
      "openOnScreenForm(id?: string, options: ControlOptions = {}): Promise<void>"
    );
    expect(documentResource).toContain(
      'this.transport.openOnScreenForm("widgets", id, options)'
    );

    const contextProject = renderOperationProject([
      operation({ namespace: "me", resourceKind: "context" }),
    ]);
    const contextResource = contextProject.generatedFiles.get(
      "src/resources/me/generated/me.base.ts"
    );
    expect(contextResource).not.toContain("openOnScreenForm");
  });
});
