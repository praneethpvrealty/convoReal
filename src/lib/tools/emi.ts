export const MAX_TENURE_YEARS = 30;

export interface EmiInput {
  principal: number;
  annualRatePercent: number;
  tenureYears: number;
}

export interface EmiYear {
  year: number;
  principalPaid: number;
  interestPaid: number;
  balance: number;
}

export interface EmiResult {
  principal: number;
  months: number;
  monthlyRate: number;
  emi: number;
  totalInterest: number;
  totalPayment: number;
  schedule: EmiYear[];
}

function round(value: number): number {
  return Math.round(value);
}

export function monthlyEmi(
  principal: number,
  annualRatePercent: number,
  months: number
): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return principal / months;
  const factor = Math.pow(1 + r, months);
  return (principal * r * factor) / (factor - 1);
}

export function calculateEmi(input: EmiInput): EmiResult {
  const principal = Math.max(0, input.principal || 0);
  const tenureYears = Math.min(
    MAX_TENURE_YEARS,
    Math.max(0, Math.floor(input.tenureYears || 0))
  );
  const months = tenureYears * 12;
  const annualRate = Math.max(0, input.annualRatePercent || 0);
  const monthlyRate = annualRate / 100 / 12;
  const emi = monthlyEmi(principal, annualRate, months);

  const schedule: EmiYear[] = [];
  let balance = principal;
  for (let year = 1; year <= tenureYears; year += 1) {
    let principalPaid = 0;
    let interestPaid = 0;
    for (let month = 0; month < 12; month += 1) {
      const interest = balance * monthlyRate;
      const towardsPrincipal = Math.min(balance, emi - interest);
      interestPaid += interest;
      principalPaid += towardsPrincipal;
      balance -= towardsPrincipal;
    }
    schedule.push({
      year,
      principalPaid: round(principalPaid),
      interestPaid: round(interestPaid),
      balance: round(Math.max(0, balance)),
    });
  }

  const totalPayment = round(emi * months);
  return {
    principal,
    months,
    monthlyRate,
    emi: round(emi),
    totalInterest: Math.max(0, totalPayment - round(principal)),
    totalPayment,
    schedule,
  };
}

export function loanAmount(
  propertyPrice: number,
  downPaymentPercent: number
): number {
  const price = Math.max(0, propertyPrice || 0);
  const share = Math.min(100, Math.max(0, downPaymentPercent || 0)) / 100;
  return Math.round(price * (1 - share));
}
