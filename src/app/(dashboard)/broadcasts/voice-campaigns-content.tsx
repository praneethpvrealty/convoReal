'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PhoneCall,
  Plus,
  Play,
  Pause,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { formatCurrencyShort } from '@/lib/currency-utils';
import { voiceCallCost } from '@/lib/credits/types';
import { callTimeValueLabel } from '@/lib/credits/time-value';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import { SearchableContactMultiSelect } from '@/components/ui/searchable-contact-multi-select';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { InfoHint } from '@/components/ui/info-hint';

interface RecipientCounts {
  queued?: number;
  calling?: number;
  completed?: number;
  no_answer?: number;
  failed?: number;
  opted_out?: number;
}

interface VoiceCampaign {
  id: string;
  name: string;
  property_id: string | null;
  agent_ref: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed';
  call_window_start_hour: number;
  call_window_end_hour: number;
  max_attempts: number;
  script_context: Record<string, string>;
  created_at: string;
  recipient_counts: RecipientCounts;
}

interface RecipientQualification {
  budgetConfirmed: boolean | null;
  statedBudget: number | null;
  statedAreas: string[];
  wantsAlternatives: boolean | null;
  doNotCall: boolean;
}

interface RecipientRow {
  id: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  qualification: RecipientQualification | null;
  contact:
    | { id: string; name: string | null; phone: string | null }
    | { id: string; name: string | null; phone: string | null }[]
    | null;
}

interface CampaignDetail extends Omit<VoiceCampaign, 'recipient_counts'> {
  recipients: RecipientRow[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

function recipientContact(r: RecipientRow) {
  return Array.isArray(r.contact) ? (r.contact[0] ?? null) : r.contact;
}

const CAMPAIGN_STATUS_STYLES: Record<VoiceCampaign['status'], string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  paused: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  completed: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
};

const RECIPIENT_STATUS_STYLES: Record<string, string> = {
  queued: 'bg-slate-800 text-slate-300 border-slate-700',
  calling: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  no_answer: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  opted_out: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};

function StatusChip({
  status,
  styles,
}: {
  status: string;
  styles: Record<string, string>;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize',
        styles[status] ?? 'border-slate-700 bg-slate-800 text-slate-300'
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function windowLabel(start: number, end: number): string {
  return `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00 IST`;
}

function QualificationChip({ q }: { q: RecipientQualification | null }) {
  if (!q) return <span className="text-xs text-slate-500">—</span>;
  if (q.doNotCall) {
    return (
      <span className="text-xs font-semibold text-rose-400">Do not call</span>
    );
  }
  if (q.budgetConfirmed === true) {
    return (
      <span className="text-xs font-semibold text-emerald-400">Qualified</span>
    );
  }
  if (q.budgetConfirmed === false) {
    return (
      <span className="text-xs font-semibold text-amber-400">
        Mismatch
        {q.statedBudget ? ` · ${formatCurrencyShort(q.statedBudget)}` : ''}
        {q.statedAreas.length > 0 ? ` · ${q.statedAreas.join(', ')}` : ''}
      </span>
    );
  }
  return <span className="text-xs text-slate-500">—</span>;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** The account's per-call price, which depends on its voice mode —
 *  byo accounts pay their own provider and are charged for
 *  orchestration only. Shares the settings card's query cache. */
function useCallCost(): number {
  const { data } = useQuery({
    queryKey: ['voice-config'],
    queryFn: () => api<{ mode: string } | null>('/api/voice-config'),
  });
  return voiceCallCost(data?.mode);
}

export default function VoiceCampaignsContent() {
  const canManage = useCan('send-messages');
  const queryClient = useQueryClient();
  const callCost = useCallCost();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ['voice-campaigns'],
    queryFn: () => api<VoiceCampaign[]>('/api/voice-campaigns'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/voice-campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/voice-campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Campaign deleted');
      queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const campaigns = campaignsQuery.data ?? [];

  if (campaignsQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Outbound qualification calls to a listing&apos;s enquirers — the voice
          agent checks budget and requirements, and answers land back on the
          contact.
          <InfoHint
            text={`Recipients are seeded from a property's enquiries — open Recipients on a campaign to add or remove people before starting it. Calls go out inside the campaign's IST window, retry unanswered numbers, and respect do-not-call. Results (stated budget, areas, opt-outs) are written back to the contact automatically. Each connected call costs ${callCost} cr — unanswered attempts are refunded.`}
          />
        </p>
        <GatedButton
          canAct={canManage}
          gateReason="create voice campaigns"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Voice Campaign
        </GatedButton>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <PhoneCall className="h-8 w-8 text-slate-600" />
          <p className="text-sm font-medium text-slate-300">
            No voice campaigns yet
          </p>
          <p className="max-w-md text-xs text-slate-500">
            Create one from a listing to call everyone who enquired about it and
            check whether the asking price fits their budget.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Call window</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Queued</TableHead>
                <TableHead>Opted out</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const counts = c.recipient_counts;
                const total = Object.values(counts).reduce(
                  (sum, n) => sum + (n ?? 0),
                  0
                );
                const done =
                  (counts.completed ?? 0) +
                  (counts.no_answer ?? 0) +
                  (counts.failed ?? 0) +
                  (counts.opted_out ?? 0);
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => setDetailId(c.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-white">{c.name}</div>
                      {c.script_context.property_title && (
                        <div className="text-xs text-slate-500">
                          {c.script_context.property_title}
                          {c.script_context.asking_price &&
                            ` · ${formatCurrencyShort(Number(c.script_context.asking_price))}`}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        status={c.status}
                        styles={CAMPAIGN_STATUS_STYLES}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {windowLabel(
                        c.call_window_start_hour,
                        c.call_window_end_hour
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-300 tabular-nums">
                      {done}/{total}
                      {(counts.completed ?? 0) > 0 && (
                        <span className="ml-1.5 text-emerald-400">
                          {counts.completed} reached
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 tabular-nums">
                      {counts.queued ?? 0}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 tabular-nums">
                      {counts.opted_out ?? 0}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDetailId(c.id)}
                        >
                          <Users className="h-3.5 w-3.5" />
                          Recipients
                        </Button>
                        {(c.status === 'draft' || c.status === 'paused') && (
                          <GatedButton
                            canAct={canManage}
                            gateReason="start voice campaigns"
                            size="sm"
                            variant="outline"
                            disabled={statusMutation.isPending}
                            onClick={() => {
                              // Starting is what commits the spend, so
                              // the trade is stated here rather than
                              // only as a per-call price.
                              const trade = callTimeValueLabel(
                                counts.queued ?? 0,
                                callCost
                              );
                              if (
                                trade &&
                                !window.confirm(
                                  `Start "${c.name}"?\n\n${trade}`
                                )
                              ) {
                                return;
                              }
                              statusMutation.mutate({
                                id: c.id,
                                status: 'active',
                              });
                            }}
                          >
                            <Play className="h-3.5 w-3.5" />
                            Start
                          </GatedButton>
                        )}
                        {c.status === 'active' && (
                          <GatedButton
                            canAct={canManage}
                            gateReason="pause voice campaigns"
                            size="sm"
                            variant="outline"
                            disabled={statusMutation.isPending}
                            onClick={() =>
                              statusMutation.mutate({
                                id: c.id,
                                status: 'paused',
                              })
                            }
                          >
                            <Pause className="h-3.5 w-3.5" />
                            Pause
                          </GatedButton>
                        )}
                        <GatedButton
                          canAct={canManage}
                          gateReason="delete voice campaigns"
                          size="sm"
                          variant="ghost"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete campaign "${c.name}" and its recipient list?`
                              )
                            ) {
                              deleteMutation.mutate(c.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        </GatedButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CampaignDetailDialog
        campaignId={detailId}
        onClose={() => setDetailId(null)}
        canManage={canManage}
      />
    </div>
  );
}

function CreateCampaignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const callCost = useCallCost();
  const [name, setName] = useState('');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [agentRef, setAgentRef] = useState('');
  const [startHour, setStartHour] = useState(10);
  const [endHour, setEndHour] = useState(19);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [seed, setSeed] = useState(true);

  const propertiesQuery = useQuery({
    queryKey: ['voice-campaigns', 'properties', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('properties')
        .select(
          'id, title, property_code, location, sublocality, price, type, bedrooms, images'
        )
        .order('created_at', { ascending: false })
        .limit(500);
      return data ?? [];
    },
    enabled: open && Boolean(accountId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<{ id: string; seeded: number }>('/api/voice-campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          property_id: propertyId,
          agent_ref: agentRef,
          call_window_start_hour: startHour,
          call_window_end_hour: endHour,
          max_attempts: maxAttempts,
          seed_from_property: seed,
        }),
      }),
    onSuccess: (created) => {
      toast.success(
        created.seeded > 0
          ? `Campaign created with ${created.seeded} recipients from the listing's enquiries`
          : 'Campaign created — add recipients, then start it'
      );
      queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
      onOpenChange(false);
      setName('');
      setPropertyId(null);
      setAgentRef('');
      setSeed(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New voice campaign</DialogTitle>
          <DialogDescription>
            The voice agent calls each recipient about the selected listing and
            captures their real budget and requirements. Costs {callCost} cr per
            connected call; unanswered attempts are refunded automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vc-name">Campaign name</Label>
            <Input
              id="vc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Koramangala 14.7 Cr — enquiry qualification"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Property</Label>
            <SearchablePropertySelect
              properties={propertiesQuery.data ?? []}
              value={propertyId}
              onChange={setPropertyId}
              placeholder="Select the listing the calls are about…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vc-agent">
              Voice agent id
              <InfoHint text="The agent's id at your voice provider (Sarvam by default). The dispatcher hands it the property title, asking price and locality as script variables." />
            </Label>
            <Input
              id="vc-agent"
              value={agentRef}
              onChange={(e) => setAgentRef(e.target.value)}
              placeholder="agent id from your voice provider"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vc-start">Calls from</Label>
              <select
                id="vc-start"
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-white"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vc-end">Until</Label>
              <select
                id="vc-end"
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-white"
              >
                {HOURS.map((h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vc-attempts">Max attempts</Label>
              <Input
                id="vc-attempts"
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-white">
                Seed from enquiries
              </p>
              <p className="text-xs text-slate-500">
                Add everyone who enquired about this listing as recipients.
              </p>
            </div>
            <Switch
              checked={seed}
              onCheckedChange={setSeed}
              disabled={!propertyId}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetailDialog({
  campaignId,
  onClose,
  canManage,
}: {
  campaignId: string | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const callCost = useCallCost();
  const [addIds, setAddIds] = useState<string[]>([]);

  const detailQuery = useQuery({
    queryKey: ['voice-campaign', campaignId],
    queryFn: () => api<CampaignDetail>(`/api/voice-campaigns/${campaignId}`),
    enabled: Boolean(campaignId),
  });

  const contactsQuery = useQuery({
    queryKey: ['voice-campaigns', 'contacts', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone, name_tag')
        .eq('is_merged', false)
        .eq('do_not_call', false)
        .not('phone', 'is', null)
        .order('created_at', { ascending: false })
        .limit(2000);
      return data ?? [];
    },
    enabled: Boolean(campaignId) && Boolean(accountId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['voice-campaign', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api<{ added: number; skipped: number }>(
        `/api/voice-campaigns/${campaignId}/recipients`,
        { method: 'POST', body: JSON.stringify({ contact_ids: addIds }) }
      ),
    onSuccess: (result) => {
      toast.success(
        `Added ${result.added} recipient${result.added === 1 ? '' : 's'}`
      );
      setAddIds([]);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (contactId: string) =>
      api<{ removed: number }>(
        `/api/voice-campaigns/${campaignId}/recipients`,
        {
          method: 'DELETE',
          body: JSON.stringify({ contact_ids: [contactId] }),
        }
      ),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const detail = detailQuery.data;
  const existingContactIds = useMemo(
    () =>
      new Set(
        (detail?.recipients ?? [])
          .map((r) => recipientContact(r)?.id)
          .filter(Boolean)
      ),
    [detail]
  );
  const addableContacts = useMemo(
    () =>
      (contactsQuery.data ?? []).filter((c) => !existingContactIds.has(c.id)),
    [contactsQuery.data, existingContactIds]
  );
  // What the calls still to be made will cost, against the agent time
  // they replace.
  const pendingTrade = callTimeValueLabel(
    (detail?.recipients ?? []).filter((r) => r.status === 'queued').length,
    callCost
  );

  return (
    <Dialog
      open={Boolean(campaignId)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {!detail ? (
          <div className="flex items-center justify-center py-16">
            <ConvoRealLoader />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {detail.name}
                <StatusChip
                  status={detail.status}
                  styles={CAMPAIGN_STATUS_STYLES}
                />
              </DialogTitle>
              <DialogDescription>
                {windowLabel(
                  detail.call_window_start_hour,
                  detail.call_window_end_hour
                )}{' '}
                · up to {detail.max_attempts} attempts
                {detail.script_context.property_title &&
                  ` · ${detail.script_context.property_title}`}
                {!detail.agent_ref &&
                  ' · using the account default from Settings → WhatsApp → Voice'}
              </DialogDescription>
            </DialogHeader>

            {pendingTrade && (
              <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
                {pendingTrade}
              </p>
            )}

            {canManage && detail.status !== 'completed' && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <SearchableContactMultiSelect
                    contacts={addableContacts}
                    value={addIds}
                    onChange={setAddIds}
                    placeholder="Add contacts to this campaign…"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={addIds.length === 0 || addMutation.isPending}
                  onClick={() => addMutation.mutate()}
                >
                  <UserPlus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Qualification</TableHead>
                    {canManage && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.recipients.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={canManage ? 5 : 4}
                        className="py-8 text-center text-sm text-slate-500"
                      >
                        No recipients yet — add contacts above.
                      </TableCell>
                    </TableRow>
                  )}
                  {detail.recipients.map((r) => {
                    const contact = recipientContact(r);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="text-sm font-medium text-white">
                            {contact?.name || 'Unknown'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {contact?.phone}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusChip
                            status={r.status}
                            styles={RECIPIENT_STATUS_STYLES}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-slate-400 tabular-nums">
                          {r.attempts}/{detail.max_attempts}
                        </TableCell>
                        <TableCell>
                          <QualificationChip q={r.qualification} />
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={removeMutation.isPending}
                              title="Remove from campaign"
                              onClick={() =>
                                contact && removeMutation.mutate(contact.id)
                              }
                            >
                              <X className="h-3.5 w-3.5 text-slate-500" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
