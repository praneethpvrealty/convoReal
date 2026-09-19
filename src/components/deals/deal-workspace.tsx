'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Layers,
  Loader2,
  User,
  Waypoints,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { dealsHref } from '@/lib/deals/routes';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { brokerageAmount, type BrokerageType } from '@/lib/pipelines/brokerage';
import {
  dealStatusForStage,
  needsBrokerageCapture,
} from '@/lib/pipelines/stage-semantics';
import { cn } from '@/lib/utils';

import { DealDocumentsPanel } from './deal-documents-panel';
import { DealFinancialsPanel } from './deal-financials-panel';
import { DealInvoicesPanel } from './deal-invoices-panel';
import { DealMilestonesPanel } from './deal-milestones-panel';
import { DealStakeholdersPanel } from './deal-stakeholders-panel';
import { DealTasksPanel } from './deal-tasks-panel';
import { DealTimelinePanel } from './deal-timeline-panel';
import { DealUpdatesPanel } from './deal-updates-panel';

type TabId =
  | 'overview'
  | 'timeline'
  | 'milestones'
  | 'tasks'
  | 'documents'
  | 'stakeholders'
  | 'updates'
  | 'invoices';

interface DealSummary {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
  brokerage_type: 'percentage' | 'fixed' | null;
  brokerage_value: number | null;
  brokerage_amount: number | null;
  status: string;
  pipeline_id: string;
  stage_id: string;
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

interface StageOption {
  id: string;
  name: string;
  position: number;
}

/** Mirrored in mobile/app/(app)/deal/[id].tsx; guarded by mobile-parity.test.ts. */
export const DEAL_WORKSPACE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'stakeholders', label: 'Stakeholders' },
  { id: 'updates', label: 'Updates' },
  { id: 'invoices', label: 'Invoices' },
];

export function DealWorkspace({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { accountId, isViewer, isReadOnly } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');
  const [movingStage, setMovingStage] = useState(false);
  const [brokeragePrompt, setBrokeragePrompt] = useState<StageOption | null>(
    null
  );
  const [brokerageType, setBrokerageType] =
    useState<BrokerageType>('percentage');
  const [brokerageValue, setBrokerageValue] = useState('');

  const canEdit = !isViewer && !isReadOnly;

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal-workspace', dealId],
    queryFn: async (): Promise<DealSummary | null> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          'id, title, value, currency, brokerage_type, brokerage_value, brokerage_amount, status, ' +
            'pipeline_id, stage_id, source_journey_item_id, deal_group_id, deal_room_id, ' +
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

  const pipelineId = deal?.pipeline_id ?? null;
  const { data: stages = [] } = useQuery({
    queryKey: ['deal-workspace-stages', pipelineId],
    queryFn: async (): Promise<StageOption[]> => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, name, position')
        .eq('pipeline_id', pipelineId!)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as StageOption[];
    },
    enabled: Boolean(pipelineId),
  });

  function pickStage(stageId: string) {
    if (!deal) return;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || stage.id === deal.stage_id) return;
    if (needsBrokerageCapture(deal, stage.name)) {
      setBrokerageType('percentage');
      setBrokerageValue('');
      setBrokeragePrompt(stage);
      return;
    }
    void moveToStage(stage);
  }

  async function moveToStage(
    stage: StageOption,
    brokerage?: { brokerage_type: BrokerageType; brokerage_value: number }
  ) {
    if (!deal) return;
    setBrokeragePrompt(null);
    setMovingStage(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: dealStatusForStage(stage.name),
          target_stage_id: stage.id,
          property_id: deal.property?.id ?? null,
          current_stage_name: stage.name,
          ...brokerage,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Could not move the deal');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deal-workspace', dealId] }),
        queryClient.invalidateQueries({
          queryKey: ['transaction-workspace-index'],
        }),
      ]);
      toast.success(`Moved to ${stage.name}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not move the deal'
      );
    } finally {
      setMovingStage(false);
    }
  }

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
          {canEdit && stages.length > 0 ? (
            <select
              aria-label="Pipeline stage"
              title="Move this deal to another pipeline stage"
              className="h-7 cursor-pointer rounded-full border border-slate-700 bg-slate-950 px-2 text-xs text-white disabled:cursor-wait disabled:opacity-60"
              value={deal.stage_id}
              disabled={movingStage}
              onChange={(e) => pickStage(e.target.value)}
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          ) : (
            deal.stage?.name && (
              <span className="rounded-full border border-slate-700 px-2 py-0.5">
                {deal.stage.name}
              </span>
            )
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
              href={dealsHref('journey', {
                item: deal.source_journey_item_id,
              })}
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
      {tab === 'stakeholders' && (
        <DealStakeholdersPanel
          dealId={dealId}
          dealTitle={deal.title}
          canEdit={canEdit}
        />
      )}
      {tab === 'updates' && (
        <DealUpdatesPanel dealId={dealId} canEdit={canEdit} />
      )}
      {tab === 'invoices' && (
        <DealInvoicesPanel dealId={dealId} canEdit={canEdit} />
      )}

      <Dialog
        open={brokeragePrompt !== null}
        onOpenChange={(open) => !open && setBrokeragePrompt(null)}
      >
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Enter brokerage details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <p className="text-xs text-slate-400">
              Moving to{' '}
              <span className="text-primary font-semibold">
                {brokeragePrompt?.name}
              </span>{' '}
              starts the closing stretch. Record the brokerage rate or amount
              first, as the pipeline board does.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="txw-brokerage-type" className="text-slate-300">
                  Brokerage type
                </Label>
                <select
                  id="txw-brokerage-type"
                  value={brokerageType}
                  onChange={(e) =>
                    setBrokerageType(e.target.value as BrokerageType)
                  }
                  className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="txw-brokerage-value" className="text-slate-300">
                  {brokerageType === 'percentage'
                    ? 'Brokerage (%)'
                    : 'Brokerage amount'}
                </Label>
                <Input
                  id="txw-brokerage-value"
                  type="number"
                  min="0"
                  value={brokerageValue}
                  onChange={(e) => setBrokerageValue(e.target.value)}
                  placeholder={brokerageType === 'percentage' ? '2' : '0'}
                  className="border-slate-700 bg-slate-950 text-white"
                />
              </div>
            </div>
            {Number(brokerageValue) > 0 && (
              <p className="text-primary text-[11px] font-semibold">
                Calculated brokerage: Rs.{' '}
                {formatIndianDigits(
                  brokerageAmount({
                    dealValue: deal.value,
                    type: brokerageType,
                    value: brokerageValue,
                  }),
                  0
                )}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrokeragePrompt(null)}>
              Cancel
            </Button>
            <Button
              disabled={!(Number(brokerageValue) > 0)}
              onClick={() =>
                brokeragePrompt &&
                void moveToStage(brokeragePrompt, {
                  brokerage_type: brokerageType,
                  brokerage_value: Number(brokerageValue),
                })
              }
            >
              Save and move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
