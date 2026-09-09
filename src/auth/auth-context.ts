export interface AuthContextSnapshot {
  readonly token: string;
  readonly expiresAtMonotonicMs: number;
  readonly generation: number;
}
