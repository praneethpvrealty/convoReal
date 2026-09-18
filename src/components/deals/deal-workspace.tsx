'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Layers,
  Loader2,
  User,
  Waypoints,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { brokerageAmount } from '@/lib/pipelines/brokerage';
import { cn } from '@/lib/utils';

import { DealDocumentsPanel } from './deal-documents-panel';
import { DealFinancialsPanel } from './deal-financials-panel';
import { DealInvoicesPanel } from './deal-invoices-panel';
import { DealMilestonesPanel } from './deal-milestones-panel';
import { DealTasksPanel } from './deal-tasks-panel';
import { DealTimelinePanel } from './deal-timeline-panel';

type TabId =
  'overview' | 'timeline' | 'milestones' | 'tasks' | 'documents' | 'invoices';

interface DealSummary {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
  brokerage_type: 'percentage' | 'fixed' | null;
  brokerage_value: number | null;
  brokerage_amount: number | null;
  status: string;
  source_journey_item_id: string | null;
  deal_group_id: string | null;
  deal_room_id: string | null;
  contact: {
    id: string;
    name: string | null;
    second_name: string | null;
  } | null;
  property: { id: string; title: string | null; unit_no: string | null } | null;
  stage: { name: string } | null;
  group: { id: string; name: string } | null;
}

/** Mirrored in mobile/app/(app)/deal/[id].tsx; guarded by mobile-parity.test.ts. */
export const DEAL_WORKSPACE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'invoices', label: 'Invoices' },
];

export function DealWorkspace({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const { accountId, isViewer, isReadOnly } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');

  const canEdit = !isViewer && !isReadOnly;

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal-workspace', dealId],
    queryFn: async (): Promise<DealSummary | null> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          'id, title, value, currency, brokerage_type, brokerage_value, brokerage_amount, status, ' +
            'source_journey_item_id, deal_group_id, deal_room_id, ' +
            'contact:contacts(id, name, second_name), ' +
            'property:properties(id, title, unit_no), ' +
            'stage:pipeline_stages(name), ' +
            'group:deal_groups(id, name)'
        )
        .eq('id', dealId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as unknown as DealSummary | null;
    },
    enabled: Boolean(accountId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading transaction…
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-sm text-slate-300">
          This transaction could not be found.
        </p>
        <Link href="/deals" className="text-primary mt-3 inline-block text-sm">
          Back to Transactions
        </Link>
      </div>
    );
  }

  const totalBrokerage =
    deal.brokerage_amount ??
    brokerageAmount({
      dealValue: deal.value,
      type: deal.brokerage_type,
      value: deal.brokerage_value,
    });

  const contactName = [deal.contact?.name, deal.contact?.second_name]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/deals"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Transactions
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          {deal.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {deal.stage?.name && (
            <span className="rounded-full border border-slate-700 px-2 py-0.5">
              {deal.stage.name}
            </span>
          )}
          {contactName && (
            <Link
              href={`/contacts?contact=${deal.contact?.id}`}
              className="inline-flex items-center gap-1 hover:text-white"
            >
              <User className="h-3.5 w-3.5" />
              {contactName}
            </Link>
          )}
          {deal.property && (
            <Link
              href={`/inventory?property=${deal.property.id}`}
              className="inline-flex items-center gap-1 hover:text-white"
            >
              <Building2 className="h-3.5 w-3.5" />
              {deal.property.unit_no
                ? `Property No. ${deal.property.unit_no}`
                : deal.property.title}
            </Link>
          )}
          {deal.source_journey_item_id && (
            <Link
              href={`/journey?item=${deal.source_journey_item_id}`}
              className="inline-flex items-center gap-1 hover:text-white"
              title="Opened from a journey; the journey keeps its own history."
            >
              <Waypoints className="h-3.5 w-3.5" />
              From journey
            </Link>
          )}
          {deal.group && (
            <span
              className="inline-flex items-center gap-1"
              title="Part of a bundle of linked transactions."
            >
              <Layers className="h-3.5 w-3.5" />
              {deal.group.name}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Deal value" value={deal.value ?? 0} />
        <SummaryTile
          label="Brokerage"
          value={totalBrokerage}
          hint={
            deal.brokerage_type === 'percentage' && deal.brokerage_value
              ? `${deal.brokerage_value}% of the deal`
              : undefined
          }
        />
        <SummaryTile
          label="Half share"
          value={Math.round(totalBrokerage / 2)}
          hint="If both sides are billed"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-slate-800/80">
        {DEAL_WORKSPACE_TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all',
              tab === item.id
                ? 'border-primary bg-primary/5 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <DealFinancialsPanel dealId={dealId} canEdit={canEdit} />
      )}
      {tab === 'timeline' && (
        <DealTimelinePanel dealId={dealId} canEdit={canEdit} />
      )}
      {tab === 'milestones' && (
        <DealMilestonesPanel dealId={dealId} canEdit={canEdit} />
      )}
      {tab === 'tasks' && (
        <DealTasksPanel
          dealId={dealId}
          contactId={deal.contact?.id ?? null}
          propertyId={deal.property?.id ?? null}
          canEdit={canEdit}
        />
      )}
      {tab === 'documents' && (
        <DealDocumentsPanel dealId={dealId} canEdit={canEdit} />
      )}
      {tab === 'invoices' && (
        <DealInvoicesPanel dealId={dealId} canEdit={canEdit} />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-white">
        Rs. {formatIndianDigits(value, 0)}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
