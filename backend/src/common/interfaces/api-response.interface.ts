/** docs/API_SPECIFICATION.md Section 2.2 */
export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: Record<string, unknown> | null;
  message: string | null;
  requestId: string;
}

/** docs/API_SPECIFICATION.md Section 2.3 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details: Array<Record<string, unknown>>;
  };
  requestId: string;
}
