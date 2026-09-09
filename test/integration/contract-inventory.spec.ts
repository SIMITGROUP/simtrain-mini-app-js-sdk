import { SimTrainSdkBase } from "../../src/generated/sdk.base";
import type {
  SdkRuntimeTransport,
  TransportRequest,
} from "../../src/transport/transport";

class InventoryTransport implements SdkRuntimeTransport {
  request<ResponseType>(request: TransportRequest): Promise<ResponseType> {
    return Promise.reject(
      new Error(`inventory transport cannot call ${request.operationId}`)
    );
  }

  openOnScreenForm(): Promise<void> {
    return Promise.reject(new Error("inventory transport cannot open forms"));
  }
}

class InventorySdk extends SimTrainSdkBase {
  constructor() {
    super(new InventoryTransport());
  }
}

function generatedMethods(resource: object): readonly string[] {
  const editablePrototype = Object.getPrototypeOf(resource) as object | null;
  const generatedPrototype =
    editablePrototype === null
      ? null
      : (Object.getPrototypeOf(editablePrototype) as object | null);
  if (generatedPrototype === null) return [];
  return Object.getOwnPropertyNames(generatedPrototype).filter(
    name => name !== "constructor"
  );
}

describe("locked public contract inventory", () => {
  it("exposes every generated browser operation exactly once", () => {
    const sdk = new InventorySdk();
    const resources = Object.entries(sdk);
    const operations = resources.flatMap(([namespace, resource]) =>
      generatedMethods(resource as object)
        .filter(method => method !== "openOnScreenForm")
        .map(method => `${namespace}.${method}`)
    );
    const formResources = resources.flatMap(([namespace, resource]) =>
      generatedMethods(resource as object).includes("openOnScreenForm")
        ? [namespace]
        : []
    );

    expect(resources).toHaveLength(34);
    expect(operations).toHaveLength(199);
    expect(new Set(operations).size).toBe(199);
    expect(operations).toEqual(
      expect.arrayContaining(["students.list", "me.get"])
    );
    expect(formResources).toHaveLength(33);
    expect(formResources).toContain("students");
    expect(formResources).not.toContain("me");
  });
});
