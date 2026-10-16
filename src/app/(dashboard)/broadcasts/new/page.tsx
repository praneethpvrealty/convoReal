'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Step1ComposeMessage } from '@/components/broadcasts/step1-compose-message';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import {
  useBroadcastSending,
  useBroadcastTemplate,
  type AudienceConfig,
} from '@/hooks/useBroadcastSending';
import {
  BROADCAST_UPDATE_TEMPLATE_NAME,
  broadcastMessageProblem,
  buildBroadcastUpdateVariables,
} from '@/lib/broadcasts/carrier-template';
import { Check } from 'lucide-react';

const steps = [
  { label: 'Message', key: 'message' },
  { label: 'Audience', key: 'audience' },
  { label: 'Send', key: 'send' },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const { createAndSendBroadcast, isProcessing, progress } =
    useBroadcastSending();
  const { user, accountId, account } = useAuth();
  const templateQuery = useBroadcastTemplate();

  const [currentStep, setCurrentStep] = useState(0);
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AudienceConfig | null>(null);
  const [name, setName] = useState('');

  async function handleSend() {
    if (broadcastMessageProblem(message) || !audience) return;

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        message,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Broadcast failed';
      console.error('Broadcast failed:', err);
      toast.error(message);
    }
  }

  /**
   * Writes a draft broadcast row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later. We
   * don't persist the in-progress audience/variable config here
   * because the current schema doesn't carry it past `audience_filter`
   * and `template_variables`; those are enough for the user to
   * recognize the draft but not to exactly round-trip into the wizard.
   * A full resume-draft UX is a future polish.
   */
  async function handleSaveDraft() {
    if (broadcastMessageProblem(message) || !audience || !name.trim()) {
      toast.error('Give the broadcast a name before saving a draft.');
      return;
    }
    const supabase = createClient();
    if (!user || !accountId) {
      toast.error('Not signed in.');
      return;
    }

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      template_name: BROADCAST_UPDATE_TEMPLATE_NAME,
      template_language: 'en_US',
      template_variables: buildBroadcastUpdateVariables(
        message,
        account?.name ?? ''
      ),
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(`Failed to save draft: ${error.message}`);
      return;
    }
    toast.success('Draft saved');
    router.push('/broadcasts');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">New Broadcast</h1>
        <p className="mt-1 text-sm text-slate-400">
          Write a message, choose who gets it, and send. ConvoReal handles the
          WhatsApp template for you.
        </p>
      </div>

      {/* Step Indicator */}
      <div
        className="flex items-center justify-between"
        data-tour="broadcast-steps"
      >
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-primary bg-primary/10 text-primary border-2'
                        : 'border border-slate-700 bg-slate-800 text-slate-500'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive
                      ? 'text-white'
                      : isCompleted
                        ? 'text-primary'
                        : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${
                    index < currentStep ? 'bg-primary' : 'bg-slate-800'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ComposeMessage
              message={message}
              onChange={setMessage}
              template={templateQuery.data}
              templateLoading={templateQuery.isLoading}
              templateError={
                templateQuery.isError
                  ? templateQuery.error instanceof Error
                    ? templateQuery.error.message
                    : 'Could not check broadcast setup'
                  : null
              }
              onRetryTemplate={() => void templateQuery.refetch()}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/broadcasts')}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && audience && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              message={message}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(1)}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
