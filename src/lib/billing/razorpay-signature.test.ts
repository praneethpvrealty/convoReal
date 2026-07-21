import { describe, expect, it } from 'vitest';
import crypto from 'crypto';

import { verifyRazorpaySignature } from './razorpay-signature';

const SECRET = 'whsec_test_razorpay';
const BODY = JSON.stringify({ event: 'subscription.charged', id: 'evt_1' });

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyRazorpaySignature', () => {
  it('accepts a signature computed over the exact raw body', () => {
    expect(verifyRazorpaySignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyRazorpaySignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(
      false
    );
  });

  it('rejects when the body was altered after signing', () => {
    const sig = sign(BODY, SECRET);
    const tampered = BODY.replace('subscription.charged', 'subscription.activated');
    expect(verifyRazorpaySignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a signature of the correct length but wrong bytes', () => {
    const sig = sign(BODY, SECRET);
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    expect(verifyRazorpaySignature(BODY, flipped, SECRET)).toBe(false);
  });

  it('rejects an empty signature without throwing (length guard)', () => {
    expect(verifyRazorpaySignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects a too-short signature without throwing (length guard)', () => {
    expect(verifyRazorpaySignature(BODY, 'abc123', SECRET)).toBe(false);
  });

  it('is byte-exact — a trailing newline on the body invalidates it', () => {
    const sig = sign(BODY, SECRET);
    expect(verifyRazorpaySignature(BODY + '\n', sig, SECRET)).toBe(false);
  });
});
