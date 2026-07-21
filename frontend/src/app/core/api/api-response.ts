/** Mirrors docs/API_SPECIFICATION.md Section 2.2/2.3 — the raw wire shape. */
export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta: Record<string, unknown> | null;
  message: string | null;
  requestId: string;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>[];
  };
  requestId: string;
}
