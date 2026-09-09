import {
  interpolatePath,
  serializeQuery,
} from "../../src/transport/query-serializer";

describe("interpolatePath", () => {
  it("encodes each declared path value exactly once", () => {
    expect(
      interpolatePath("/v2/students/{id}", { id: "already%2Fraw / value" })
    ).toBe("/v2/students/already%252Fraw%20%2F%20value");
  });

  it("rejects missing, extra, and non-primitive path values", () => {
    expect(() => interpolatePath("/v2/students/{id}", {})).toThrow(/missing/i);
    expect(() =>
      interpolatePath("/v2/students/{id}", { id: "x", extra: "y" })
    ).toThrow(/extra/i);
    expect(() =>
      interpolatePath("/v2/students/{id}", { id: { nested: true } })
    ).toThrow(/primitive/i);
  });
});

describe("serializeQuery", () => {
  it("implements form/explode arrays, null, booleans, and omission", () => {
    expect(
      serializeQuery([
        { name: "id", value: ["a", "b"], style: "form", explode: true },
        { name: "empty", value: null, style: "form", explode: true },
        { name: "active", value: false, style: "form", explode: true },
        { name: "absent", value: undefined, style: "form", explode: true },
      ])
    ).toBe("id=a&id=b&empty=&active=false");
  });
});
