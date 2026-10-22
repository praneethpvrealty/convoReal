'use client';

// Slim setup-progress card shown on the dashboard home when the
// onboarding wizard was dismissed with steps still open — the wizard
// itself is modal-or-nothing, so without this the remaining setup is
// invisible. "Resume" clears the dismissal and reopens the wizard.

import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/useLocale';
import type { MessageKey } from '@/lib/i18n/messages';
import {
  setupSteps,
  type OnboardingStatus,
  type SetupStepId,
} from '@/lib/onboarding/checklist';

interface Props {
  status: OnboardingStatus;
  emailLeadsSkipped: boolean;
  onResume: () => void;
}

export const SETUP_STEP_LABEL: Record<SetupStepId, MessageKey> = {
  whatsapp: 'setup.whatsapp',
  property: 'setup.property',
  contact: 'setup.contacts',
  'email-leads': 'setup.emailLeads',
};

export function SetupChecklist({ status, emailLeadsSkipped, onResume }: Props) {
  const t = useT();
  const items = setupSteps(status, emailLeadsSkipped);
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 backdrop-blur-sm">
      <p className="text-sm font-medium text-white">
        {t('setup.title')}{' '}
        <span className="text-slate-400">
          · {doneCount}/{items.length}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => (
          <span
            key={item.id}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              item.done
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {item.done && <Check className="size-3" />}
            {t(SETUP_STEP_LABEL[item.id])}
          </span>
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onResume}
        className="ml-auto gap-1 border-slate-700 text-slate-200 hover:bg-slate-800"
      >
        {t('setup.resume')} <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
