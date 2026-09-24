export const AREA_TYPES = ['urban', 'rural'] as const;
export type AreaType = (typeof AREA_TYPES)[number];

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  urban: 'City or town (corporation, municipality, town panchayat)',
  rural: 'Village (gram panchayat)',
};

export interface StampDutySlab {
  upTo: number | null;
  rate: number;
}

export const KARNATAKA_STAMP_DUTY = {
  slabs: [
    { upTo: 2_000_000, rate: 0.02 },
    { upTo: 4_500_000, rate: 0.03 },
    { upTo: null, rate: 0.05 },
  ] as StampDutySlab[],
  surcharge: { urban: 0.02, rural: 0.03 } as Record<AreaType, number>,
  cess: 0.1,
  registration: 0.02,
};

export interface StampDutyInput {
  consideration: number;
  guidanceValue?: number | null;
  areaType: AreaType;
}

export interface StampDutyResult {
  chargeableValue: number;
  basis: 'consideration' | 'guidance_value';
  dutyRate: number;
  stampDuty: number;
  surchargeRate: number;
  surcharge: number;
  cessRate: number;
  cess: number;
  registrationRate: number;
  registrationFee: number;
  total: number;
  effectiveRate: number;
}

export function stampDutyRate(value: number): number {
  for (const slab of KARNATAKA_STAMP_DUTY.slabs) {
    if (slab.upTo === null || value <= slab.upTo) return slab.rate;
  }
  return KARNATAKA_STAMP_DUTY.slabs[KARNATAKA_STAMP_DUTY.slabs.length - 1].rate;
}

function round(value: number): number {
  return Math.round(value);
}

export function calculateStampDuty(input: StampDutyInput): StampDutyResult {
  const consideration = Math.max(0, input.consideration || 0);
  const guidance = Math.max(0, input.guidanceValue || 0);
  const basis = guidance > consideration ? 'guidance_value' : 'consideration';
  const chargeableValue = Math.max(consideration, guidance);

  const dutyRate = stampDutyRate(chargeableValue);
  const stampDuty = round(chargeableValue * dutyRate);
  const surchargeRate = KARNATAKA_STAMP_DUTY.surcharge[input.areaType];
  const surcharge = round(stampDuty * surchargeRate);
  const cessRate = KARNATAKA_STAMP_DUTY.cess;
  const cess = round(stampDuty * cessRate);
  const registrationRate = KARNATAKA_STAMP_DUTY.registration;
  const registrationFee = round(chargeableValue * registrationRate);
  const total = stampDuty + surcharge + cess + registrationFee;

  return {
    chargeableValue,
    basis,
    dutyRate,
    stampDuty,
    surchargeRate,
    surcharge,
    cessRate,
    cess,
    registrationRate,
    registrationFee,
    total,
    effectiveRate: chargeableValue > 0 ? total / chargeableValue : 0,
  };
}

export function percentText(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
