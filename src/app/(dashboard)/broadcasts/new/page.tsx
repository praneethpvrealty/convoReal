'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Step1ComposeMessage } from '@/components/broadcasts/step1-compose-message';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import {
  useBroadcastSending,
  useBroadcastTemplate,
  type AudienceConfig,
} from '@/hooks/useBroadcastSending';
import { broadcastMessageProblem } from '@/lib/broadcasts/carrier-template';
import { Check } from 'lucide-react';

const DISCARD_BROADCAST_CONFIRM =
  'Discard this broadcast? Your message and audience will be lost.';

const steps = [
  { label: 'Message', key: 'message' },
  { label: 'Audience', key: 'audience' },
  { label: 'Send', key: 'send' },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const { createAndSendBroadcast, isProcessing, progress } =
    useBroadcastSending();
  const templateQuery = useBroadcastTemplate();

  const [currentStep, setCurrentStep] = useState(0);
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AudienceConfig | null>(null);
  const [optedInOnly, setOptedInOnly] = useState(false);
  const [name, setName] = useState('');
  const sentRef = useRef(false);

  const hasContent =
    message.trim() !== '' || audience !== null || name.trim() !== '';
  const guardLeave = hasContent && !isProcessing;

  useEffect(() => {
    if (!guardLeave) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sentRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guardLeave]);

  function leaveWizard() {
    if (hasContent && !window.confirm(DISCARD_BROADCAST_CONFIRM)) return;
    router.push('/broadcasts');
  }

  // Counted in SQL (migration 284), not with a client-side
  // count: 'exact' over the account's contacts — see AGENTS.md §2.6.
  const optedInCountQuery = useQuery({
    queryKey: ['contacts', 'consent-counts'],
    queryFn: async () => {
      const res = await fetch('/api/contacts/consent-counts');
      const body = (await res.json().catch(() => ({}))) as {
        data?: { granted?: number };
      };
      return typeof body.data?.granted === 'number' ? body.data.granted : null;
    },
    enabled: currentStep === 2,
    staleTime: 60_000,
  });

  async function handleSend() {
    if (broadcastMessageProblem(message) || !audience) return;

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        message,
        optedInOnly,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
      });
      sentRef.current = true;
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Broadcast failed';
      console.error('Broadcast failed:', err);
      toast.error(message);
    }
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
              onBack={leaveWizard}
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
              optedInOnly={optedInOnly}
              onOptedInOnlyChange={setOptedInOnly}
              optedInCount={optedInCountQuery.data ?? null}
              onSend={handleSend}
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
