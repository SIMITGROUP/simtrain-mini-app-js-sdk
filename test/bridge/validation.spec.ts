import { validateGatewayBaseUrl } from "../../src/bridge/validation";

describe("validateGatewayBaseUrl", () => {
  it("accepts HTTPS and exact HTTP loopback origins", () => {
    expect(validateGatewayBaseUrl("https://gateway.simtrain.test/")).toBe(
      "https://gateway.simtrain.test"
    );
    expect(validateGatewayBaseUrl("http://localhost:8201/")).toBe(
      "http://localhost:8201"
    );
    expect(validateGatewayBaseUrl("http://127.0.0.1:8201/")).toBe(
      "http://127.0.0.1:8201"
    );
    expect(validateGatewayBaseUrl("http://[::1]:8201/")).toBe(
      "http://[::1]:8201"
    );
  });

  it("rejects HTTP origins outside the exact loopback allowlist", () => {
    expect(
      validateGatewayBaseUrl("http://gateway.simtrain.test")
    ).toBeUndefined();
    expect(validateGatewayBaseUrl("http://192.168.1.10:8201")).toBeUndefined();
    expect(
      validateGatewayBaseUrl("http://localhost.example:8201")
    ).toBeUndefined();
  });
});
