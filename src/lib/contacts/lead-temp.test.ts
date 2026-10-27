import { describe, expect, it } from 'vitest';

import {
  LEAD_TEMP_NONE_LABEL,
  LEAD_TEMP_OPTIONS,
  LEAD_TEMPS,
  VIP_BADGE_LABEL,
  isLeadTemp,
  isVipTag,
  leadTempLabel,
} from './lead-temp';

describe('[UIX-006] lead temperature labels', () => {
  it('[UIX-006] labels every stored value with its emoji', () => {
    expect(LEAD_TEMPS.map(leadTempLabel)).toEqual([
      '🔥 HOT',
      '❄️ COLD',
      '⏳ Not Responding',
      '💀 Dead',
    ]);
  });

  it('[UIX-006] offers None then the four values in order', () => {
    expect(LEAD_TEMP_NONE_LABEL).toBe('None');
    expect(LEAD_TEMP_OPTIONS).toEqual([
      { value: 'HOT', label: '🔥 HOT' },
      { value: 'COLD', label: '❄️ COLD' },
      { value: 'Not Responding', label: '⏳ Not Responding' },
      { value: 'Dead', label: '💀 Dead' },
    ]);
  });

  it('[UIX-006] gives no badge for an empty or unknown value', () => {
    expect(leadTempLabel(null)).toBeNull();
    expect(leadTempLabel(undefined)).toBeNull();
    expect(leadTempLabel('')).toBeNull();
    expect(leadTempLabel('hot')).toBeNull();
    expect(isLeadTemp('WARM')).toBe(false);
    expect(isLeadTemp('Dead')).toBe(true);
  });

  it('[UIX-006] recognises the VIP tag in any case', () => {
    expect(VIP_BADGE_LABEL).toBe('⭐ VIP');
    expect(isVipTag('VIP')).toBe(true);
    expect(isVipTag('vip')).toBe(true);
    expect(isVipTag(' Vip ')).toBe(true);
    expect(isVipTag('VIP buyer')).toBe(false);
    expect(isVipTag(null)).toBe(false);
  });
});
