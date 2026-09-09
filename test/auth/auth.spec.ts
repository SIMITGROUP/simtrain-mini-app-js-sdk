import type { AuthContextSnapshot } from "../../src/auth/auth-context";
import { Auth } from "../../src/auth/auth";

describe("Auth", () => {
  it("returns only the same token used by the internal context", async () => {
    const context: AuthContextSnapshot = {
      token: "shared-token",
      expiresAtMonotonicMs: 1_000,
      generation: 1,
    };
    const manager = {
      getContext: jest.fn().mockResolvedValue(context),
    };
    const auth = new Auth(manager);

    await expect(auth.getToken()).resolves.toBe("shared-token");
    expect(manager.getContext).toHaveBeenCalledWith({
      forceRefresh: false,
      signal: undefined,
    });
  });
});
