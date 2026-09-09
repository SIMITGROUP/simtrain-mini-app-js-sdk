import { SimTrainApiError } from "../../src/errors/api-error";

describe("SimTrainApiError", () => {
  it("keeps only sanitized public response metadata", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid student",
          details: [{ field: "name", message: "Required", internal: "drop" }],
          upstream: { secret: true },
        },
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-1",
          "retry-after": "12",
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          authorization: "Bearer never-copy",
        },
      }
    );

    const result = await SimTrainApiError.fromResponse(response);

    expect(result).toMatchObject({
      code: "API_ERROR",
      status: 400,
      apiCode: "VALIDATION_FAILED",
      requestId: "request-1",
      retryAfter: "12",
      rateLimit: { limit: 100, remaining: 0 },
      details: [{ field: "name", message: "Required" }],
    });
    expect(JSON.stringify(result)).not.toContain("never-copy");
    expect(JSON.stringify(result)).not.toContain("upstream");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
