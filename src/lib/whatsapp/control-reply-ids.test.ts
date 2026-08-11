import { describe, expect, it } from 'vitest';
import { isEngineControlReplyId } from '@/lib/whatsapp/control-reply-ids';
import {
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
} from '@/lib/inventory/location-requests';

describe('isEngineControlReplyId', () => {
  // Regression: tapping Approve on an owner-queue ping was relayed into
  // a lead thread by the reply bridge, and the approval never ran.
  it('claims every owner and consent decision button', () => {
    for (const prefix of [
      OWNER_APPROVE_PREFIX,
      OWNER_REJECT_PREFIX,
      CONSENT_APPROVE_PREFIX,
      CONSENT_DECLINE_PREFIX,
    ]) {
      expect(
        isEngineControlReplyId(`${prefix}3f2c8a1e-4b6d-4f0a-9c2e-8d7b6a5f4e3d`),
        prefix
      ).toBe(true);
    }
  });

  it('leaves a genuine staff reply to the bridge', () => {
    expect(isEngineControlReplyId('Yes please, call them')).toBe(false);
    expect(isEngineControlReplyId('')).toBe(false);
    expect(isEngineControlReplyId('share_property_yes:abc')).toBe(false);
  });

  it('does not match a prefix appearing mid-string', () => {
    expect(isEngineControlReplyId(`re: ${OWNER_APPROVE_PREFIX}x`)).toBe(false);
  });
});
