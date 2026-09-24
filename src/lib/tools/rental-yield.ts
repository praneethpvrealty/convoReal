export interface RentalYieldInput {
  price: number;
  monthlyRent: number;
  annualExpenses?: number | null;
  vacancyMonths?: number | null;
  purchaseCosts?: number | null;
}

export interface RentalYieldResult {
  price: number;
  totalInvestment: number;
  grossAnnualRent: number;
  vacancyLoss: number;
  annualExpenses: number;
  netAnnualIncome: number;
  grossYield: number;
  netYield: number;
  paybackYears: number | null;
}

export const TARGET_YIELDS = [0.02, 0.03, 0.04, 0.06, 0.08] as const;

function clampMonths(value: number | null | undefined): number {
  return Math.min(12, Math.max(0, value || 0));
}

function nonNegative(value: number | null | undefined): number {
  return Math.max(0, value || 0);
}

export function calculateRentalYield(
  input: RentalYieldInput
): RentalYieldResult {
  const price = nonNegative(input.price);
  const monthlyRent = nonNegative(input.monthlyRent);
  const annualExpenses = nonNegative(input.annualExpenses);
  const purchaseCosts = nonNegative(input.purchaseCosts);
  const vacancyMonths = clampMonths(input.vacancyMonths);

  const totalInvestment = price + purchaseCosts;
  const grossAnnualRent = monthlyRent * 12;
  const vacancyLoss = monthlyRent * vacancyMonths;
  const netAnnualIncome = grossAnnualRent - vacancyLoss - annualExpenses;

  return {
    price,
    totalInvestment,
    grossAnnualRent: Math.round(grossAnnualRent),
    vacancyLoss: Math.round(vacancyLoss),
    annualExpenses: Math.round(annualExpenses),
    netAnnualIncome: Math.round(netAnnualIncome),
    grossYield: price > 0 ? grossAnnualRent / price : 0,
    netYield: totalInvestment > 0 ? netAnnualIncome / totalInvestment : 0,
    paybackYears:
      netAnnualIncome > 0 && totalInvestment > 0
        ? totalInvestment / netAnnualIncome
        : null,
  };
}

export function monthlyRentForYield(price: number, yieldRate: number): number {
  return Math.round((nonNegative(price) * Math.max(0, yieldRate)) / 12);
}
