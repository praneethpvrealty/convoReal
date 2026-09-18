import { describe, expect, it } from 'vitest';
import { assessRegistration } from './registration-state';

describe('[WAN-003] registration state comes from Meta, never from assumption', () => {
  it('treats only a CLOUD_API platform as registered', () => {
    expect(
      assessRegistration({
        status: 'CONNECTED',
        platformType: 'CLOUD_API',
        nameStatus: 'APPROVED',
        verifiedName: 'PV Realty',
        pinEnabled: true,
      })
    ).toEqual({ registered: true, nameApproved: true, reason: null });
  });

  it('names a declined display name as the reason a number cannot register', () => {
    const result = assessRegistration({
      status: 'PENDING',
      platformType: 'NOT_APPLICABLE',
      nameStatus: 'DECLINED',
      verifiedName: 'Aryavarta Realty',
      pinEnabled: false,
    });
    expect(result?.registered).toBe(false);
    expect(result?.nameApproved).toBe(false);
    expect(result?.reason).toContain(
      'declined the display name "Aryavarta Realty"'
    );
    expect(result?.reason).toContain('two-step PIN');
  });

  it('reports an unregistered number with an accepted name as needing the PIN', () => {
    const result = assessRegistration({
      status: 'PENDING',
      platformType: 'NOT_APPLICABLE',
      nameStatus: 'AVAILABLE_WITHOUT_REVIEW',
      verifiedName: null,
      pinEnabled: false,
    });
    expect(result?.registered).toBe(false);
    expect(result?.nameApproved).toBe(true);
    expect(result?.reason).toContain('(status PENDING)');
  });

  it('stays silent when Meta exposes no platform, so test numbers keep working', () => {
    expect(assessRegistration(null)).toBeNull();
    expect(
      assessRegistration({
        status: null,
        platformType: null,
        nameStatus: null,
        verifiedName: null,
        pinEnabled: null,
      })
    ).toBeNull();
  });
});
