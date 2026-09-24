import { describe, expect, it } from 'vitest';

import {
  KARNATAKA_STAMP_DUTY,
  calculateStampDuty,
  percentText,
  stampDutyRate,
} from './stamp-duty';

describe('calculateStampDuty', () => {
  it('[PUB-004] charges duty on the higher of the sale price and the guidance value', () => {
    const onPrice = calculateStampDuty({
      consideration: 12_000_000,
      guidanceValue: 9_000_000,
      areaType: 'urban',
    });
    expect(onPrice.basis).toBe('consideration');
    expect(onPrice.chargeableValue).toBe(12_000_000);

    const onGuidance = calculateStampDuty({
      consideration: 8_000_000,
      guidanceValue: 9_000_000,
      areaType: 'urban',
    });
    expect(onGuidance.basis).toBe('guidance_value');
    expect(onGuidance.chargeableValue).toBe(9_000_000);
    expect(onGuidance.stampDuty).toBe(450_000);
  });

  it('[PUB-004] applies the slab rate to the whole value and the area surcharge to the duty', () => {
    expect(stampDutyRate(1_500_000)).toBe(0.02);
    expect(stampDutyRate(2_000_000)).toBe(0.02);
    expect(stampDutyRate(3_000_000)).toBe(0.03);
    expect(stampDutyRate(4_500_000)).toBe(0.03);
    expect(stampDutyRate(4_500_001)).toBe(0.05);

    const urban = calculateStampDuty({
      consideration: 10_000_000,
      areaType: 'urban',
    });
    expect(urban.stampDuty).toBe(500_000);
    expect(urban.surcharge).toBe(
      500_000 * KARNATAKA_STAMP_DUTY.surcharge.urban
    );
    expect(urban.cess).toBe(500_000 * KARNATAKA_STAMP_DUTY.cess);
    expect(urban.registrationFee).toBe(
      10_000_000 * KARNATAKA_STAMP_DUTY.registration
    );
    expect(urban.total).toBe(
      urban.stampDuty + urban.surcharge + urban.cess + urban.registrationFee
    );
    expect(urban.effectiveRate).toBeCloseTo(urban.total / 10_000_000, 6);

    const rural = calculateStampDuty({
      consideration: 10_000_000,
      areaType: 'rural',
    });
    expect(rural.surcharge).toBe(
      500_000 * KARNATAKA_STAMP_DUTY.surcharge.rural
    );
    expect(rural.total).toBeGreaterThan(urban.total);
  });

  it('[PUB-004] yields zero for an empty or negative value', () => {
    const result = calculateStampDuty({ consideration: -5, areaType: 'urban' });
    expect(result.chargeableValue).toBe(0);
    expect(result.total).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it('[PUB-004] prints rates as short percentages', () => {
    expect(percentText(0.05)).toBe('5%');
    expect(percentText(0.1)).toBe('10%');
    expect(percentText(0.0565)).toBe('5.65%');
    expect(percentText(0.056)).toBe('5.6%');
  });
});
