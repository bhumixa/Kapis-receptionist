import { ulid } from 'ulid';

const REQUEST_ID_PATTERN = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

/** `req_<26-char ULID>`, per docs/API_SPECIFICATION.md Section 2.9. */
export function generateRequestId(): string {
  return `req_${ulid()}`;
}

/** Echoes a well-formed client-supplied request ID, otherwise mints a new one. */
export function resolveRequestId(
  clientSupplied: string | string[] | undefined,
): string {
  const candidate = Array.isArray(clientSupplied)
    ? clientSupplied[0]
    : clientSupplied;
  if (candidate && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return generateRequestId();
}
