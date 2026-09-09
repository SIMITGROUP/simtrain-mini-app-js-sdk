import type { AuthContextSnapshot } from "./auth-context";

export interface GetTokenOptions {
  readonly forceRefresh?: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface AuthContextReader {
  getContext(options?: {
    readonly forceRefresh?: boolean;
    readonly signal?: AbortSignal | undefined;
  }): Promise<AuthContextSnapshot>;
}

export class Auth {
  constructor(private readonly manager: AuthContextReader) {}

  async getToken(options: GetTokenOptions = {}): Promise<string> {
    const context = await this.manager.getContext({
      forceRefresh: options.forceRefresh ?? false,
      signal: options.signal,
    });
    return context.token;
  }
}
