// Mirrors src/lib/credits/time-value.ts — the mobile app is a separate
// Expo project and cannot import from src/. Keep the constants and the
// arithmetic identical; see that file for why each assumption is set to
// understate the saving rather than flatter it.

export const CREDIT_INR = 0.099;
export const MANUAL_CALLS_PER_HOUR = 14;
export const DEFAULT_MONTHLY_SALARY_INR = 150_000;
export const WORKING_HOURS_PER_MONTH = 200;

export function hourlyValueInr(
  monthlySalaryInr: number = DEFAULT_MONTHLY_SALARY_INR
): number {
  if (!Number.isFinite(monthlySalaryInr) || monthlySalaryInr <= 0) return 0;
  return monthlySalaryInr / WORKING_HOURS_PER_MONTH;
}

export interface CallTimeValue {
  credits: number;
  rupees: number;
  manualHours: number;
  manualRupees: number;
  savedRupees: number;
}

export function callTimeValue(
  callCount: number,
  costPerCall: number,
  monthlySalaryInr: number = DEFAULT_MONTHLY_SALARY_INR
): CallTimeValue {
  const calls = Math.max(0, Math.floor(callCount));
  const credits = calls * Math.max(0, costPerCall);
  const rupees = credits * CREDIT_INR;
  const manualHours = calls / MANUAL_CALLS_PER_HOUR;
  const manualRupees = manualHours * hourlyValueInr(monthlySalaryInr);
  return {
    credits,
    rupees,
    manualHours,
    manualRupees,
    savedRupees: manualRupees - rupees,
  };
}

function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function callTimeValueLabel(
  callCount: number,
  costPerCall: number,
  monthlySalaryInr: number = DEFAULT_MONTHLY_SALARY_INR
): string | null {
  const v = callTimeValue(callCount, costPerCall, monthlySalaryInr);
  if (v.credits <= 0) return null;
  const hours =
    v.manualHours >= 1
      ? `${v.manualHours.toFixed(v.manualHours < 10 ? 1 : 0)} hours`
      : `${Math.round(v.manualHours * 60)} minutes`;
  const base = `${v.credits.toLocaleString('en-IN')} cr (${inr(v.rupees)}) for calls that would take an agent ${hours} by hand — ${inr(v.manualRupees)} of their time`;
  return v.savedRupees > 0
    ? `${base}. Saves about ${inr(v.savedRupees)}.`
    : `${base}.`;
}
