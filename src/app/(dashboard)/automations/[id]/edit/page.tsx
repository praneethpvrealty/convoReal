'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LoadError } from '@/components/ui/load-error';
import { FlowNodeLoader } from '@/components/ui/flow-node-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from '@/components/automations/automation-builder';
import type { AutomationTriggerType } from '@/types';

class AutomationLoadError extends Error {
  status: number;
  constructor(status: number) {
    super(`Failed to load (${status})`);
    this.status = status;
  }
}

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const query = useQuery({
    queryKey: ['automation-edit', id],
    queryFn: async (): Promise<BuilderInitial> => {
      const res = await fetch(`/api/automations/${id}`);
      if (!res.ok) throw new AutomationLoadError(res.status);
      const body = await res.json();
      return {
        id: body.automation.id,
        name: body.automation.name ?? '',
        description: body.automation.description ?? '',
        trigger_type: body.automation.trigger_type as AutomationTriggerType,
        trigger_config: body.automation.trigger_config ?? {},
        is_active: !!body.automation.is_active,
        steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
      };
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const initial = query.data ?? null;

  if (query.isError) {
    const notFound =
      query.error instanceof AutomationLoadError && query.error.status === 404;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4">
        {notFound ? (
          <p className="text-sm text-red-400">
            This automation no longer exists.
          </p>
        ) : (
          <div className="w-full max-w-md">
            <LoadError
              what="this automation"
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          </div>
        )}
        <button
          onClick={() => router.push('/automations')}
          className="text-primary hover:text-primary/80 text-sm"
        >
          Back to Automations
        </button>
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="flex h-screen flex-col items-center justify-center text-slate-400">
        <FlowNodeLoader
          size={104}
          label="Loading automation"
          className="mb-3"
        />
        <ConvoRealLoader size={20} className="mb-2" />
        <p className="text-sm">Loading automation...</p>
      </div>
    );
  }

  return <AutomationBuilder initial={initial} />;
}
