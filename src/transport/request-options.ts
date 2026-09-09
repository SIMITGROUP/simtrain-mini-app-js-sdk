export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
  readonly requestId?: string;
}
