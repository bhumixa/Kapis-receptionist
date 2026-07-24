import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of the `X-Internal-Api-Key` header against the
 * configured `AI_INTERNAL_API_KEY` secret — same "length mismatch is itself
 * 'invalid', not an error to propagate" treatment as
 * `whatsapp-signature.util.ts`'s `verifyWhatsAppSignature`. A pure function
 * for the same reason: trivially unit-testable without any Nest DI
 * scaffolding.
 */
export function verifyInternalApiKey(
  expected: string,
  provided: string | undefined,
): boolean {
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
