import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies Meta's `X-Hub-Signature-256` header (API_SPECIFICATION.md
 * Section 2.12): HMAC-SHA256 of the raw request body, keyed by the Meta
 * App's secret, formatted as `sha256=<hex>`. `timingSafeEqual` avoids a
 * timing side-channel on the comparison; a length mismatch (which
 * `timingSafeEqual` would throw on) is itself treated as "invalid", not an
 * error to propagate.
 *
 * A pure function, not an injectable service — deliberately, so it's
 * trivially unit-testable with synthetic payloads/secrets without any Nest
 * DI scaffolding (this is exactly the kind of function `test/unit/whatsapp/
 * whatsapp-signature.util.spec.ts` exercises against the security-critical
 * paths: missing header, malformed header, wrong secret, tampered body).
 */
export function verifyWhatsAppSignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const provided = Buffer.from(providedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
