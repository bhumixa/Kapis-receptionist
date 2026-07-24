import { createHmac } from 'node:crypto';
import { verifyWhatsAppSignature } from '../../../src/modules/whatsapp/infrastructure/whatsapp-signature.util';

const APP_SECRET = 'test-app-secret';

function sign(body: Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyWhatsAppSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const header = sign(body);

    expect(verifyWhatsAppSignature(APP_SECRET, body, header)).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}');
    expect(verifyWhatsAppSignature(APP_SECRET, body, undefined)).toBe(false);
  });

  it('rejects a malformed header (no sha256= prefix)', () => {
    const body = Buffer.from('{}');
    expect(
      verifyWhatsAppSignature(APP_SECRET, body, 'not-a-real-signature'),
    ).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const header = sign(body, 'a-different-secret');

    expect(verifyWhatsAppSignature(APP_SECRET, body, header)).toBe(false);
  });

  it('rejects a tampered body (valid signature for a different payload)', () => {
    const originalBody = Buffer.from(JSON.stringify({ amount: 10 }));
    const header = sign(originalBody);
    const tamperedBody = Buffer.from(JSON.stringify({ amount: 1000000 }));

    expect(verifyWhatsAppSignature(APP_SECRET, tamperedBody, header)).toBe(
      false,
    );
  });

  it('rejects a signature of the wrong length without throwing', () => {
    const body = Buffer.from('{}');
    expect(() =>
      verifyWhatsAppSignature(APP_SECRET, body, 'sha256=deadbeef'),
    ).not.toThrow();
    expect(verifyWhatsAppSignature(APP_SECRET, body, 'sha256=deadbeef')).toBe(
      false,
    );
  });
});
