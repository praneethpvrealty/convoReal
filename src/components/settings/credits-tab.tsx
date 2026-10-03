'use client';

import { Coins } from 'lucide-react';
import { CreditBreakdown } from './CreditBreakdown';
import { CreditFeatureChart } from './CreditFeatureChart';
import { CreditLedger } from './CreditLedger';
import { ReferralHub } from './ReferralHub';
import { useTopupModal } from '@/components/layout/topup-modal-context';
import { VerifyPaymentsButton } from './VerifyPaymentsButton';

export function CreditsTab() {
  const { openTopupModal } = useTopupModal();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Credits</h2>
          <p className="text-sm text-slate-400">
            Manage your AI credit balance, usage, and referrals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VerifyPaymentsButton />
          <button
            type="button"
            onClick={openTopupModal}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
          >
            <Coins className="size-4" />
            Buy Credits
          </button>
        </div>
      </div>

      <CreditBreakdown />
      <CreditFeatureChart />
      <CreditLedger />
      <ReferralHub />
    </div>
  );
}
