/**
 * The frontend's typed shape for every API failure, normalized from
 * docs/API_SPECIFICATION.md Section 2.3's error envelope by ApiClient
 * (Section 10.3) — callers only ever see this, never a raw HttpErrorResponse.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown>[],
    public readonly requestId: string | null,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
