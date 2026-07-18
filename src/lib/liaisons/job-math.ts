import type { LiaisonJob, LiaisonJobPayment } from '@/types';

export interface JobTotals {
  /** Cash in from the client so far. */
  received: number;
  /** Cash out to the liaison so far. */
  paid: number;
  /** client_charge - received; null when no charge is agreed. */
  clientBalance: number | null;
  /** liaison_fee - paid; null when no fee is agreed. */
  liaisonBalance: number | null;
  /** client_charge - liaison_fee; null unless both are agreed. */
  agreedMargin: number | null;
  /** received - paid — the margin actually in hand right now. */
  realizedMargin: number;
}

export function computeJobTotals(
  job: Pick<LiaisonJob, 'client_charge' | 'liaison_fee'>,
  payments: LiaisonJobPayment[],
): JobTotals {
  let received = 0;
  let paid = 0;
  for (const p of payments) {
    if (p.direction === 'in') received += p.amount;
    else paid += p.amount;
  }

  const charge = job.client_charge;
  const fee = job.liaison_fee;

  return {
    received,
    paid,
    clientBalance: charge !== null && charge !== undefined ? charge - received : null,
    liaisonBalance: fee !== null && fee !== undefined ? fee - paid : null,
    agreedMargin:
      charge !== null && charge !== undefined && fee !== null && fee !== undefined
        ? charge - fee
        : null,
    realizedMargin: received - paid,
  };
}
