// ============================================================
// What a campaign costs, next to what doing it by hand costs.
//
// A price in credits means nothing to a broker deciding whether to
// run a campaign. The comparison that does: the same calls made by a
// salaried agent, whose hour has a rupee value. Shown wherever the
// credit price is disclosed, so the number being charged arrives with
// the number it replaces.
//
// Every figure here is an assumption, and each one is deliberately
// set so the comparison UNDERSTATES the saving rather than flatters
// it: credits are valued at the most expensive pack (a customer
// buying in bulk pays less per credit, so their real saving is
// larger), and the manual rate is a brisk one that assumes the agent
// dials continuously and takes notes as they go.
// ============================================================

/**
 * Rupees per credit at the smallest pack (1,000 cr for ₹99,
 * migration 087). Bulk packs go down to ₹0.062, so quoting the
 * dearest credit keeps the comparison honest.
 */
export const CREDIT_INR = 0.099;

/** Calls an agent gets through in an hour of steady dialling —
 *  2-3 minutes of conversation plus dialling, no-answers and notes. */
export const MANUAL_CALLS_PER_HOUR = 14;

/** The salary the default comparison assumes, and the working month
 *  it is spread over: 25 days x 8 hours = 200 hours. */
export const DEFAULT_MONTHLY_SALARY_INR = 150_000;
export const WORKING_HOURS_PER_MONTH = 200;

/** An agent's hour, in rupees. */
export function hourlyValueInr(
  monthlySalaryInr: number = DEFAULT_MONTHLY_SALARY_INR
): number {
  if (!Number.isFinite(monthlySalaryInr) || monthlySalaryInr <= 0) return 0;
  return monthlySalaryInr / WORKING_HOURS_PER_MONTH;
}

export interface CallTimeValue {
  /** Credits the calls will burn if every one connects. */
  credits: number;
  /** Those credits in rupees. */
  rupees: number;
  /** Hours the same calls would take an agent by hand. */
  manualHours: number;
  /** What those hours cost in salary. */
  manualRupees: number;
  /** Salary saved. Negative when the calls cost more than the time. */
  savedRupees: number;
}

/**
 * The trade for a run of `callCount` calls at `costPerCall` credits.
 *
 * Assumes every call connects, which is the worst case for us — the
 * unanswered ones are refunded, so a real campaign costs less than
 * this and saves more.
 */
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

/**
 * One line for the UI, or null when there is nothing to compare —
 * an empty recipient list has no trade to describe.
 */
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
