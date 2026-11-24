'use client';

import { useState, useEffect, useRef, createElement } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
  Property,
} from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PriceHint } from '@/components/ui/price-hint';
import { parseAmountInput } from '@/lib/format/currency';
import { DealInvoices } from '@/components/pipelines/deal-invoices';
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrencyIcon } from '@/lib/currency-utils';
import { brokerageAmount } from '@/lib/pipelines/brokerage';
import {
  dealStatusForStage,
  isBrokeragePaidStage,
  isBrokeragePendingStage,
  isLostStage,
  pipelineOutcomeForStage,
  shouldCaptureBrokerage,
  stageTypeOf,
} from '@/lib/pipelines/stage-semantics';
import { LostReasonDialog } from './lost-reason-dialog';
import {
  LOST_REASONS,
  isLostReason,
  answeredLostReason,
  lostReasonNeedsNote,
  type LostReason,
  type LostReasonInput,
} from '@/lib/pipelines/lost-reasons';
import { formatCurrency } from '@/lib/format/currency';
import { focusFirstField } from '@/lib/forms/focus-first-field';
import {
  DEAL_PARTICIPANT_ROLES,
  DEAL_PARTICIPANT_ROLE_LABELS,
  MAX_DEAL_PARTICIPANTS,
  dealCreateWarning,
  participantRoleForContact,
  participantRoleForStakeholder,
  type DealParticipantInput,
  type DealParticipantRole,
} from '@/lib/deals/participants';

interface DealFormFields {
  title: string;
  value: string;
  currency: string;
  contactId: string;
  stageId: string;
  assignedTo: string;
  expectedCloseDate: string;
  actualCloseDate: string;
  notes: string;
  lostReason: LostReason | null;
  lostNote: string;
  propertyId: string;
  brokerageType: 'percentage' | 'fixed';
  brokerageValue: string;
}

function dealFormSnapshot(fields: DealFormFields): string {
  return JSON.stringify(fields);
}

export interface DealFormSeed {
  appointmentId: string | null;
  title: string;
  participants: DealParticipantInput[];
  propertyId: string | null;
}

function peopleSnapshot(
  contactId: string,
  primaryRole: DealParticipantRole,
  others: readonly DealParticipantInput[]
): string {
  return JSON.stringify([
    [contactId, primaryRole],
    ...others.map((p) => [p.contact_id, p.role]),
  ]);
}

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  seed?: DealFormSeed | null;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  seed,
  onSaved,
}: DealFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [contactId, setContactId] = useState('');
  const [primaryRole, setPrimaryRole] = useState<DealParticipantRole>('buyer');
  const [otherPeople, setOtherPeople] = useState<DealParticipantInput[]>([]);
  const peopleBaseline = useRef<string | null>(null);
  const [peopleState, setPeopleState] = useState<
    'loading' | 'ready' | 'failed'
  >('ready');
  const [stageId, setStageId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [actualCloseDate, setActualCloseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lostReason, setLostReason] = useState<LostReason | null>(null);
  const [lostNote, setLostNote] = useState('');
  const [lostPromptOpen, setLostPromptOpen] = useState(false);
  const lostPanelRef = useRef<HTMLDivElement>(null);
  const [propertyId, setPropertyId] = useState('');
  const [brokerageType, setBrokerageType] = useState<'percentage' | 'fixed'>(
    'percentage'
  );
  const [brokerageValue, setBrokerageValue] = useState('');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseline = useRef<DealFormFields | null>(null);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      baseline.current = null;
      return;
    }
    setConfirmDelete(false);
    if (deal) {
      baseline.current = {
        title: deal.title,
        value: String(deal.value ?? ''),
        currency: deal.currency || 'INR',
        contactId: deal.contact_id ?? '',
        stageId: deal.stage_id,
        assignedTo: deal.assigned_to ?? '',
        expectedCloseDate: deal.expected_close_date ?? '',
        actualCloseDate: deal.actual_close_date ?? '',
        notes: deal.notes ?? '',
        lostReason: isLostReason(deal.lost_reason) ? deal.lost_reason : null,
        lostNote: deal.lost_note ?? '',
        propertyId: deal.property_id ?? '',
        brokerageType: deal.brokerage_type === 'fixed' ? 'fixed' : 'percentage',
        brokerageValue: deal.brokerage_value
          ? String(deal.brokerage_value)
          : '',
      };
      setTitle(deal.title);
      setValue(String(deal.value ?? ''));
      setCurrency(deal.currency || 'INR');
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? '');
      setPrimaryRole('buyer');
      setOtherPeople([]);
      peopleBaseline.current = null;
      setPeopleState('loading');
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? '');
      setExpectedCloseDate(deal.expected_close_date ?? '');
      setActualCloseDate(deal.actual_close_date ?? '');
      setNotes(deal.notes ?? '');
      setLostReason(isLostReason(deal.lost_reason) ? deal.lost_reason : null);
      setLostNote(deal.lost_note ?? '');
      setPropertyId(deal.property_id ?? '');
      setBrokerageType(
        deal.brokerage_type === 'fixed' ? 'fixed' : 'percentage'
      );
      setBrokerageValue(
        deal.brokerage_value ? String(deal.brokerage_value) : ''
      );
    } else {
      const seedPrimary = seed?.participants[0] ?? null;
      const seedOthers = seed?.participants.slice(1) ?? [];
      setTitle(seed?.title ?? '');
      setPrimaryRole(seedPrimary?.role ?? 'buyer');
      setOtherPeople(seedOthers);
      peopleBaseline.current = peopleSnapshot('', 'buyer', []);
      setPeopleState('ready');
      setValue('');
      if (accountId) {
        supabase
          .from('showcase_settings')
          .select('currency')
          .eq('account_id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            const loaded = data?.currency || 'INR';
            setCurrency(loaded);
            if (baseline.current) {
              baseline.current = { ...baseline.current, currency: loaded };
            }
          });
      } else {
        setCurrency('INR');
      }
      baseline.current = {
        title: '',
        value: '',
        currency: 'INR',
        contactId: '',
        stageId: defaultStageId || stages[0]?.id || '',
        assignedTo: '',
        expectedCloseDate: '',
        actualCloseDate: '',
        notes: '',
        lostReason: null,
        lostNote: '',
        propertyId: '',
        brokerageType: 'percentage',
        brokerageValue: '',
      };
      setContactId(seed?.participants[0]?.contact_id ?? '');
      setStageId(defaultStageId || stages[0]?.id || '');
      setAssignedTo('');
      setExpectedCloseDate('');
      setActualCloseDate('');
      setNotes('');
      setLostReason(null);
      setLostNote('');
      setPropertyId(seed?.propertyId ?? '');
      setBrokerageType('percentage');
      setBrokerageValue('');
    }
  }, [open, deal, defaultStageId, stages, accountId, supabase, seed]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p, prop] = await Promise.all([
        supabase.from('contacts').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('properties').select('*').order('title'),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
      setProperties((prop.data ?? []) as Property[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // An existing deal's other contacts are its contact-linked buyer,
  // seller and broker stakeholders.
  const dealId = deal?.id ?? null;
  const dealContactId = deal?.contact_id ?? '';
  useEffect(() => {
    if (!open || !dealId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('deal_stakeholders')
        .select('contact_id, role')
        .eq('deal_id', dealId)
        .not('contact_id', 'is', null)
        .order('created_at');
      if (cancelled) return;
      if (error) {
        setPeopleState('failed');
        return;
      }
      const people: DealParticipantInput[] = [];
      for (const row of (data ?? []) as {
        contact_id: string;
        role: string;
      }[]) {
        const role = participantRoleForStakeholder(row.role);
        if (!role || people.some((p) => p.contact_id === row.contact_id)) {
          continue;
        }
        people.push({ contact_id: row.contact_id, role });
      }
      const storedPrimary =
        people.find((p) => p.contact_id === dealContactId)?.role ?? 'buyer';
      const others = people.filter((p) => p.contact_id !== dealContactId);
      setPrimaryRole(storedPrimary);
      setOtherPeople(others);
      peopleBaseline.current = peopleSnapshot(
        dealContactId,
        storedPrimary,
        others
      );
      setPeopleState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId, dealContactId, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  function currentSnapshot() {
    return dealFormSnapshot({
      title,
      value,
      currency,
      contactId,
      stageId,
      assignedTo,
      expectedCloseDate,
      actualCloseDate,
      notes,
      lostReason,
      lostNote,
      propertyId,
      brokerageType,
      brokerageValue,
    });
  }

  const people = otherPeople.filter((p) => p.contact_id !== contactId);

  function peopleChanged(): boolean {
    return (
      peopleBaseline.current !== null &&
      peopleBaseline.current !== peopleSnapshot(contactId, primaryRole, people)
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    if (
      !nextOpen &&
      !saving &&
      baseline.current !== null &&
      (dealFormSnapshot(baseline.current) !== currentSnapshot() ||
        peopleChanged()) &&
      !window.confirm('Discard your unsaved changes to this deal?')
    ) {
      return;
    }
    onOpenChange(nextOpen);
  }

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error('Title, contact, and stage are required');
      focusFirstField(
        [
          !title.trim() && 'deal-title',
          !contactId && 'deal-contact',
          !stageId && 'deal-stage',
        ].filter((id): id is string => Boolean(id))
      );
      return;
    }
    setSaving(true);

    const selectedStage = stages.find((s) => s.id === stageId);
    const isNegotiationOrLater = selectedStage
      ? shouldCaptureBrokerage(selectedStage)
      : false;

    const dealValue = parseAmountInput(value) ?? 0;
    const brokValue = isNegotiationOrLater
      ? parseFloat(brokerageValue) || 0
      : null;
    const brokerageAmt = isNegotiationOrLater
      ? brokerageAmount({
          dealValue,
          type: brokerageType,
          value: brokValue,
        })
      : null;

    const dealStatus: DealStatus = selectedStage
      ? dealStatusForStage(selectedStage)
      : deal?.status === 'won' || deal?.status === 'lost'
        ? deal.status
        : 'open';
    const isClosed = dealStatus !== 'open';
    if (
      dealStatus === 'lost' &&
      (!lostReason || (lostReasonNeedsNote(lostReason) && !lostNote.trim()))
    ) {
      toast.error('Pick why the deal was lost');
      setSaving(false);
      lostPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      lostPanelRef.current
        ?.querySelector<HTMLElement>(
          lostReason ? 'input' : 'button[aria-pressed]'
        )
        ?.focus({ preventScroll: true });
      return;
    }

    const payload = {
      title: title.trim(),
      value: dealValue,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
      actual_close_date: isClosed ? actualCloseDate || null : null,
      property_id: propertyId || null,
      brokerage_type: isNegotiationOrLater ? brokerageType : null,
      brokerage_value: brokValue,
      brokerage_amount: brokerageAmt,
      status: dealStatus,
      ...(dealStatus === 'lost'
        ? { lost_reason: lostReason, lost_note: lostNote.trim() || null }
        : {}),
      // Server uses this to atomically sync property status
      stage_name: selectedStage?.name ?? null,
      ...(peopleChanged()
        ? {
            participants: [
              { contact_id: contactId, role: primaryRole },
              ...people,
            ],
          }
        : {}),
      ...(!deal && seed?.appointmentId
        ? { appointment_id: seed.appointmentId }
        : {}),
    };

    let warning: string | null = null;
    try {
      const url = deal ? `/api/deals/${deal.id}` : '/api/deals';
      const method = deal ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: 'Failed to save deal' }));
        toast.error(data.error || 'Failed to save deal');
        setSaving(false);
        return;
      }
      if (!deal) {
        warning = dealCreateWarning(await res.json().catch(() => null));
      }
    } catch {
      toast.error('Failed to save deal');
      setSaving(false);
      return;
    }

    setSaving(false);
    if (warning) toast.warning(warning);
    else toast.success(deal ? 'Deal updated' : 'Deal created');
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(
    status: DealStatus,
    lost: LostReasonInput | null = null
  ) {
    if (!deal) return;
    if (status === 'lost' && !lost) {
      const lostStage = [...stages]
        .sort((a, b) => a.position - b.position)
        .find((s) => isLostStage(s));
      const answered = answeredLostReason(lostReason, lostNote);
      if (answered) {
        lost = answered;
      } else if (lostStage) {
        const current = stages.find((s) => s.id === stageId);
        if (!current || !isLostStage(current)) {
          setStageId(lostStage.id);
          if (!actualCloseDate) {
            setActualCloseDate(new Date().toLocaleDateString('en-CA'));
          }
        }
        toast.error('Pick why the deal was lost');
        requestAnimationFrame(() =>
          lostPanelRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        );
        return;
      } else {
        setLostPromptOpen(true);
        return;
      }
    }
    setStatusAction(status);

    const byPosition = [...stages].sort((a, b) => a.position - b.position);
    let targetStageId = deal.stage_id;
    if (status === 'lost') {
      const lostStage = byPosition.find((s) => isLostStage(s));
      if (lostStage) {
        targetStageId = lostStage.id;
      }
    } else if (status === 'won') {
      const wonStage =
        byPosition.find((s) => stageTypeOf(s) === 'won') ??
        byPosition.find((s) => isBrokeragePendingStage(s));
      if (wonStage) {
        targetStageId = wonStage.id;
      }
    } else {
      const currentStage = stages.find((s) => s.id === deal.stage_id);
      if (currentStage && isBrokeragePaidStage(currentStage)) {
        const pendingStage = stages.find((s) => isBrokeragePendingStage(s));
        if (pendingStage) targetStageId = pendingStage.id;
      } else if (
        currentStage &&
        pipelineOutcomeForStage(currentStage) !== 'active'
      ) {
        const lastActiveStage = [...stages]
          .sort((a, b) => b.position - a.position)
          .find((stage) => pipelineOutcomeForStage(stage) === 'active');
        if (lastActiveStage) targetStageId = lastActiveStage.id;
      }
    }

    const activePropId = deal.property_id || propertyId;
    const targetStage = stages.find((s) => s.id === (targetStageId || stageId));
    const effectiveStatus = targetStage
      ? dealStatusForStage(targetStage)
      : status;

    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: effectiveStatus,
          target_stage_id: targetStageId,
          property_id: activePropId || null,
          current_stage_name: targetStage?.name ?? null,
          ...(lost ?? {}),
        }),
      });

      setStatusAction(null);

      if (!res.ok) {
        toast.error('Failed to update deal status');
        return;
      }
    } catch {
      setStatusAction(null);
      toast.error('Failed to update deal status');
      return;
    }

    toast.success(
      status === 'won'
        ? 'Marked as won'
        : status === 'lost'
          ? 'Marked as lost'
          : 'Deal reopened'
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/deals/${deal.id}`, { method: 'DELETE' });
      setDeleting(false);
      if (!res.ok) {
        toast.error('Failed to delete deal');
        return;
      }
    } catch {
      setDeleting(false);
      toast.error('Failed to delete deal');
      return;
    }

    toast.success('Deal deleted');
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  function formatCalculatedBrokerage() {
    const amt = brokerageAmount({
      dealValue: parseAmountInput(value) ?? 0,
      type: brokerageType,
      value: brokerageValue,
    });

    if (currency === 'INR') return formatCurrency(amt);
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'د.إ',
    };
    const sym = symbols[currency] || '';
    return `${sym}${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  const selectedStage = stages.find((s) => s.id === stageId);
  const isNegotiationOrLater = selectedStage
    ? shouldCaptureBrokerage(selectedStage)
    : false;
  const isClosedStage = selectedStage
    ? dealStatusForStage(selectedStage) !== 'open'
    : false;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-lg"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-slate-700/50 p-4">
            <SheetTitle className="text-white">
              {deal ? 'Edit Deal' : 'New Deal'}
            </SheetTitle>
            {deal && (
              <Link
                href={`/deals/${deal.id}`}
                className="text-primary mt-1 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open deal folder — invoices &amp; documents
              </Link>
            )}
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label htmlFor="deal-title" className="text-slate-300">
                Title
              </Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Deal title"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-contact" className="text-slate-300">
                Contact
              </Label>
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <select
                  id="deal-contact"
                  value={contactId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setContactId(next);
                    setPrimaryRole(
                      participantRoleForContact(
                        contacts.find((c) => c.id === next)?.classification
                      )
                    );
                  }}
                  className="focus:border-primary focus:ring-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:ring-1"
                >
                  <option value="">Select a contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Primary contact's role"
                  disabled={peopleState !== 'ready'}
                  value={primaryRole}
                  onChange={(e) =>
                    setPrimaryRole(e.target.value as DealParticipantRole)
                  }
                  className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none"
                >
                  {DEAL_PARTICIPANT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {DEAL_PARTICIPANT_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>

              {people.map((person) => {
                const contact = contacts.find(
                  (c) => c.id === person.contact_id
                );
                const name = contact?.name || contact?.phone || 'Contact';
                return (
                  <div
                    key={person.contact_id}
                    className="grid grid-cols-[1fr_110px_auto] items-center gap-2"
                  >
                    <span className="truncate rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-2 text-sm text-white">
                      {name}
                    </span>
                    <select
                      aria-label={`${name}'s role`}
                      value={person.role}
                      onChange={(e) =>
                        setOtherPeople((prev) =>
                          prev.map((p) =>
                            p.contact_id === person.contact_id
                              ? {
                                  ...p,
                                  role: e.target.value as DealParticipantRole,
                                }
                              : p
                          )
                        )
                      }
                      className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none"
                    >
                      {DEAL_PARTICIPANT_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {DEAL_PARTICIPANT_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${name} from this deal`}
                      onClick={() =>
                        setOtherPeople((prev) =>
                          prev.filter((p) => p.contact_id !== person.contact_id)
                        )
                      }
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}

              {peopleState === 'failed' && (
                <p role="alert" className="text-xs font-medium text-red-400">
                  Could not load this deal&apos;s other contacts, so they cannot
                  be changed here. Close and reopen the deal to try again.
                </p>
              )}

              {peopleState === 'ready' &&
                contactId &&
                people.length + 1 < MAX_DEAL_PARTICIPANTS && (
                  <select
                    aria-label="Add another contact to this deal"
                    value=""
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setOtherPeople((prev) => [
                        ...prev.filter((p) => p.contact_id !== next),
                        {
                          contact_id: next,
                          role: participantRoleForContact(
                            contacts.find((c) => c.id === next)?.classification
                          ),
                        },
                      ]);
                    }}
                    className="focus:border-primary h-9 w-full rounded-lg border border-dashed border-slate-700 bg-slate-800/40 px-2.5 text-sm text-slate-300 outline-none"
                  >
                    <option value="">
                      + Add another buyer, seller or agent
                    </option>
                    {contacts
                      .filter(
                        (c) =>
                          c.id !== contactId &&
                          !people.some((p) => p.contact_id === c.id)
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.phone}
                        </option>
                      ))}
                  </select>
                )}

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
                >
                  <MessageSquare className="h-3 w-3" />
                  Link to Conversation
                </Link>
              )}
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-300">Property (Inventory)</Label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="focus:border-primary focus:ring-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:ring-1"
              >
                <option value="">No Property Link</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.location})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Value</Label>
                <div className="relative">
                  {createElement(getCurrencyIcon(currency), {
                    className:
                      'absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500',
                  })}
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-slate-700 bg-slate-800 pl-7 text-white"
                  />
                </div>
                <PriceHint
                  value={parseAmountInput(value) ?? ''}
                  currency={currency}
                  className="mt-1"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Currency</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED (د.إ)</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-300">Expected Close Date</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            {isClosedStage && (
              <div className="grid gap-2">
                <Label className="text-slate-300">Actual Close Date</Label>
                <Input
                  type="date"
                  value={actualCloseDate}
                  onChange={(e) => setActualCloseDate(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white"
                />
                <p className="text-[11px] text-slate-500">
                  The day the deal actually closed. Left empty it stays
                  unrecorded — the expected date is not overwritten.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="deal-stage" className="text-slate-300">
                Stage
              </Label>
              <select
                id="deal-stage"
                value={stageId}
                onChange={(e) => {
                  setStageId(e.target.value);
                  const next = stages.find((s) => s.id === e.target.value);
                  // Moving a deal to a closing stage almost always means
                  // it closed today; the agent can still change it.
                  if (
                    next &&
                    dealStatusForStage(next) !== 'open' &&
                    !actualCloseDate
                  ) {
                    setActualCloseDate(new Date().toLocaleDateString('en-CA'));
                  }
                }}
                className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedStage && isLostStage(selectedStage) && (
              <div
                ref={lostPanelRef}
                className="grid gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3"
              >
                <Label className="text-slate-300">Why was it lost?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {LOST_REASONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={lostReason === option}
                      onClick={() => setLostReason(option)}
                      className={
                        lostReason === option
                          ? 'rounded-full border border-red-400/60 bg-red-500/15 px-2.5 py-1 text-xs font-medium text-white'
                          : 'rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600'
                      }
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <Input
                  value={lostNote}
                  onChange={(e) => setLostNote(e.target.value)}
                  maxLength={500}
                  placeholder={
                    lostReasonNeedsNote(lostReason)
                      ? 'What happened?'
                      : 'Note (optional)'
                  }
                  className="border-slate-700 bg-slate-800 text-sm text-white"
                />
              </div>
            )}

            {isNegotiationOrLater && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="grid gap-2">
                  <Label className="text-slate-300">Brokerage Type</Label>
                  <select
                    value={brokerageType}
                    onChange={(e) =>
                      setBrokerageType(e.target.value as 'percentage' | 'fixed')
                    }
                    className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm font-medium text-white outline-none"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Value</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="font-medium text-slate-300">
                    {brokerageType === 'percentage'
                      ? 'Brokerage (%)'
                      : 'Brokerage Amount'}
                  </Label>
                  <Input
                    type="number"
                    value={brokerageValue}
                    onChange={(e) => setBrokerageValue(e.target.value)}
                    placeholder={brokerageType === 'percentage' ? '2' : '0'}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                </div>
                {brokerageValue &&
                  !isNaN(Number(brokerageValue)) &&
                  Number(brokerageValue) > 0 && (
                    <div className="col-span-2 mt-1">
                      <p className="text-primary text-[11px] font-semibold">
                        Calculated Brokerage: {formatCalculatedBrokerage()}
                      </p>
                    </div>
                  )}
              </div>
            )}

            {deal ? (
              <DealInvoices dealId={deal.id} />
            ) : (
              <div className="grid gap-2">
                <Label className="text-slate-300">Invoices</Label>
                <p className="text-xs text-slate-500">
                  Create the deal first, then attach the brokerage invoice.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-slate-300">Assigned To</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none"
              >
                <option value="">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-300">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="min-h-[100px] border-slate-700 bg-slate-800 text-white"
              />
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <p className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                  Status
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange('won')}
                    disabled={!!statusAction || deal.status === 'won'}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 disabled:opacity-50"
                  >
                    {statusAction === 'won' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Mark as Won
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange('lost')}
                    disabled={!!statusAction || deal.status === 'lost'}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === 'lost' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Mark as Lost
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== 'open' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange('open')}
                    disabled={!!statusAction}
                    className="w-full text-slate-400 hover:text-white"
                  >
                    Reopen deal
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-slate-700/50 bg-slate-900/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
              >
                {saving ? 'Saving...' : deal ? 'Save Changes' : 'Create Deal'}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Delete this deal?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? 'Deleting...' : 'Confirm'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Deal
                </button>
              ))}
          </div>
        </div>
        <LostReasonDialog
          dealTitle={lostPromptOpen && deal ? deal.title : null}
          onCancel={() => setLostPromptOpen(false)}
          onConfirm={(lost) => {
            setLostPromptOpen(false);
            void handleStatusChange('lost', lost);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
