import { loadSdkContractFromText } from "./openapi-loader";

function contract(operationOverrides = "", extraPaths = ""): string {
  return `
openapi: 3.0.3
info: { title: Test, version: 2.0.0 }
paths:
  /v2/widgets/{id}:
    get:
      operationId: getWidget
      x-sdk-namespace: widgets
      x-sdk-method: get
      x-sdk-visibility: browser
      x-sdk-resource-kind: document
      security:
        - serviceBearer: []
          x-org: []
        - miniAppUserBearer: []
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Widget' }
        '404':
          description: missing
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
      ${operationOverrides}
${extraPaths}
components:
  securitySchemes:
    serviceBearer:
      type: http
      scheme: bearer
      x-sdk-managed: true
    miniAppUserBearer:
      type: http
      scheme: bearer
      x-sdk-managed: true
    x-org:
      type: apiKey
      in: header
      name: x-org
      x-sdk-managed: true
  schemas:
    Widget:
      type: object
      required: [id]
      properties:
        id: { type: string }
    ErrorResponse:
      type: object
      properties:
        message: { type: string }
`;
}

describe("loadSdkContractFromText", () => {
  it("loads browser operations and preserves local schema references", () => {
    const loaded = loadSdkContractFromText(contract(), "contract.yaml");

    expect(loaded.operations).toEqual([
      expect.objectContaining({
        operationId: "getWidget",
        namespace: "widgets",
        methodName: "get",
        resourceKind: "document",
        httpMethod: "get",
        path: "/v2/widgets/{id}",
        parameters: [
          expect.objectContaining({
            name: "id",
            location: "path",
            required: true,
            style: "simple",
            explode: false,
          }),
        ],
      }),
    ]);
    expect(loaded.operations[0]?.successResponses[0]?.schema).toEqual({
      $ref: "#/components/schemas/Widget",
    });
    expect(loaded.schemas.Widget?.required).toEqual(["id"]);
  });

  it.each([
    ["namespace", "x-sdk-namespace: widgets", "x-sdk-namespace"],
    ["method", "x-sdk-method: get", "x-sdk-method"],
    ["visibility", "x-sdk-visibility: browser", "x-sdk-visibility"],
    ["resource kind", "x-sdk-resource-kind: document", "x-sdk-resource-kind"],
  ])("rejects missing SDK %s at its document location", (_name, line, key) => {
    expect(() =>
      loadSdkContractFromText(contract().replace(`      ${line}\n`, ""))
    ).toThrow(new RegExp(`paths\\./v2/widgets/\\{id\\}\\.get\\.${key}`));
  });

  it("requires both bearer alternatives and SDK-managed infrastructure", () => {
    expect(() =>
      loadSdkContractFromText(
        contract().replace("      x-sdk-managed: true\n", "")
      )
    ).toThrow(/components\.securitySchemes\.serviceBearer\.x-sdk-managed/);

    expect(() =>
      loadSdkContractFromText(
        contract().replace(/ {8}- miniAppUserBearer: \[\]\n/, "")
      )
    ).toThrow(/paths\.\/v2\/widgets\/\{id\}\.get\.security/);
  });

  it("accepts exact browser security inherited from the document root", () => {
    const operationSecurity = `      security:
        - serviceBearer: []
          x-org: []
        - miniAppUserBearer: []
`;
    const inherited = contract()
      .replace(operationSecurity, "")
      .replace(
        "components:\n",
        `${operationSecurity.replaceAll(/^ {6}/gm, "")}components:\n`
      );

    expect(loadSdkContractFromText(inherited).operations).toHaveLength(1);
  });

  it("excludes an authenticated server-only operation from the browser SDK", () => {
    const loaded = loadSdkContractFromText(
      contract(
        "",
        `
  /v2/installations:
    get:
      operationId: listInstallations
      x-sdk-namespace: installations
      x-sdk-method: list
      x-sdk-visibility: server
      x-sdk-resource-kind: infrastructure
      security:
        - serviceBearer: []
      responses:
        '200': { description: ok }
`
      )
    );

    expect(loaded.operations.map(({ operationId }) => operationId)).toEqual([
      "getWidget",
    ]);
  });

  it("requires x-org only on the service bearer alternative", () => {
    expect(() =>
      loadSdkContractFromText(
        contract().replace(
          "        - miniAppUserBearer: []\n",
          "        - miniAppUserBearer: []\n          x-org: []\n"
        )
      )
    ).toThrow(/paths\.\/v2\/widgets\/\{id\}\.get\.security/);

    expect(() =>
      loadSdkContractFromText(
        contract().replace(
          "        - serviceBearer: []\n          x-org: []\n",
          "        - serviceBearer: []\n"
        )
      )
    ).toThrow(/paths\.\/v2\/widgets\/\{id\}\.get\.security/);
  });

  it("rejects duplicate and case-folded SDK method collisions", () => {
    const duplicate = contract(
      "",
      `
  /v2/widgets:
    get:
      operationId: listWidgets
      x-sdk-namespace: Widgets
      x-sdk-method: GET
      x-sdk-visibility: browser
      x-sdk-resource-kind: document
      security:
        - serviceBearer: []
          x-org: []
        - miniAppUserBearer: []
      responses:
        '204': { description: empty }
`
    );
    expect(() => loadSdkContractFromText(duplicate)).toThrow(
      /SDK method collision.*widgets\.get/i
    );
  });

  it.each(["__proto__", "prototype", "constructor", "not-safe"])(
    "rejects unsafe or reserved SDK keys (%s)",
    value => {
      expect(() =>
        loadSdkContractFromText(
          contract().replace("x-sdk-method: get", `x-sdk-method: ${value}`)
        )
      ).toThrow(/x-sdk-method/);
    }
  );

  it("rejects unsupported and inconsistent browser resource kinds", () => {
    expect(() =>
      loadSdkContractFromText(
        contract().replace(
          "x-sdk-resource-kind: document",
          "x-sdk-resource-kind: infrastructure"
        )
      )
    ).toThrow(/x-sdk-resource-kind/);

    const mixed = contract(
      "",
      `
  /v2/widgets:
    get:
      operationId: listWidgets
      x-sdk-namespace: widgets
      x-sdk-method: list
      x-sdk-visibility: browser
      x-sdk-resource-kind: context
      security:
        - serviceBearer: []
          x-org: []
        - miniAppUserBearer: []
      responses:
        '204': { description: empty }
`
    );
    expect(() => loadSdkContractFromText(mixed)).toThrow(
      /inconsistent resource kind.*widgets/i
    );
  });

  it("rejects unsafe paths and external references", () => {
    expect(() =>
      loadSdkContractFromText(
        contract().replace("/v2/widgets/{id}", "/v2/../admin")
      )
    ).toThrow(/paths\.\/v2\/\.\.\/admin/);
    expect(() =>
      loadSdkContractFromText(
        contract().replace(
          "#/components/schemas/Widget",
          "https://example.test/schema.yaml"
        )
      )
    ).toThrow(/external \$ref.*responses\.200/);
  });

  it("rejects unsupported request media and schema constructs", () => {
    const withBody = contract().replace(
      "      responses:",
      `      requestBody:
        required: true
        content:
          multipart/form-data:
            schema: { type: object }
      responses:`
    );
    expect(() => loadSdkContractFromText(withBody)).toThrow(
      /requestBody\.content.*application\/json/
    );

    expect(() =>
      loadSdkContractFromText(
        contract().replace(
          "type: object\n      required",
          "not: {}\n      type: object\n      required"
        )
      )
    ).toThrow(/components\.schemas\.Widget\.not/);
  });

  it("rejects non-OpenAPI-3 documents", () => {
    expect(() =>
      loadSdkContractFromText(
        contract().replace("openapi: 3.0.3", "openapi: 3.1.0")
      )
    ).toThrow(/openapi/);
  });
});
