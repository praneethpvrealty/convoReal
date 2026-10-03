'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Radar,
  RefreshCw,
  Send,
  X,
  User,
  Building,
  AlertTriangle,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { loadMatchEvents } from '@/lib/radar/queries';
import {
  DEFAULT_ALERT_MIN_SCORE,
  defaultSelectedTargetIds,
  isImplausibleListingPrice,
} from '@/lib/radar/alert-defaults';
import {
  buildPropertyAlertTemplatePayload,
  PROPERTY_ALERT_TEMPLATE_NAME,
} from '@/lib/whatsapp/property-alert-template';
import type { MatchEvent, Property, RadarManualContact } from '@/types';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import { MatchTargetRow } from '@/components/matching/match-target-row';
import { InfoHint } from '@/components/ui/info-hint';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { DirectOwnerCard } from '@/components/radar/direct-owner-card';
import { ManualContactPicker } from '@/components/radar/manual-contact-picker';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import { formatInrCompact } from '@/lib/format/currency';

interface CheckedState {
  /** Event ID -> Set of target IDs. */
  [eventId: string]: Set<string>;
}

const TARGET_PREVIEW_COUNT = 6;

function defaultSelection(event: MatchEvent): Set<string> {
  return new Set(defaultSelectedTargetIds(event.matches));
}

export default function RadarPage() {
  const { accountId } = useAuth();
  const queryClient = useQueryClient();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // Checked state for targets within each event card
  const [checkedTargets, setCheckedTargets] = useState<CheckedState>({});
  const [manualContacts, setManualContacts] = useState<{
    [eventId: string]: RadarManualContact[];
  }>({});
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(
    () => new Set()
  );

  // Recipients that couldn't be reached because they're outside the 24h
  // window AND the property-details template isn't approved yet —
  // sending is template-first, so this only appears until the one-time
  // template setup is done.
  const [templateMissingTargets, setTemplateMissingTargets] = useState<{
    [eventId: string]: Array<{ id: string; name: string }>;
  }>({});
  const [alertTemplateStatus, setAlertTemplateStatus] = useState<string | null>(
    null
  );
  const [submittingAlertTemplate, setSubmittingAlertTemplate] = useState(false);

  const eventsQueryKey = ['match-radar', accountId];
  const eventsQuery = useQuery({
    queryKey: eventsQueryKey,
    queryFn: () => loadMatchEvents(createClient()),
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const events = eventsQuery.data ?? null;

  useEffect(() => {
    if (!eventsQuery.isError) return;
    console.error('[radar] fetch failed:', eventsQuery.error);
    toast.error('Failed to load Match Radar feed');
  }, [eventsQuery.isError, eventsQuery.error]);

  const removeEvent = (eventId: string) =>
    queryClient.setQueryData<MatchEvent[]>(eventsQueryKey, (prev) =>
      prev?.filter((e) => e.id !== eventId)
    );

  const refreshFeed = async () => {
    const result = await eventsQuery.refetch();
    if (result.isSuccess) {
      setCheckedTargets({});
      setManualContacts({});
      setTemplateMissingTargets({});
      setExpandedEvents(new Set());
    }
  };

  const selectionFor = (event: MatchEvent) =>
    checkedTargets[event.id] ?? defaultSelection(event);

  // Target checkbox toggle
  const toggleTarget = (event: MatchEvent, targetId: string) => {
    setCheckedTargets((prev) => {
      const current = new Set(prev[event.id] ?? defaultSelection(event));
      if (current.has(targetId)) {
        current.delete(targetId);
      } else {
        current.add(targetId);
      }
      return { ...prev, [event.id]: current };
    });
  };

  const updateManualContacts = (
    event: MatchEvent,
    contacts: RadarManualContact[]
  ) => {
    setManualContacts((prev) => ({ ...prev, [event.id]: contacts }));
    setCheckedTargets((prev) => {
      const current = new Set(prev[event.id] ?? defaultSelection(event));
      const nextIds = new Set(contacts.map((contact) => contact.id));
      for (const oldContact of manualContacts[event.id] ?? []) {
        if (!nextIds.has(oldContact.id)) current.delete(oldContact.id);
      }
      for (const contact of contacts) current.add(contact.id);
      return { ...prev, [event.id]: current };
    });
  };

  // Select/Deselect all targets for a card
  const toggleSelectAll = (event: MatchEvent, allIds: string[]) => {
    setCheckedTargets((prev) => {
      const current = prev[event.id] ?? defaultSelection(event);
      const anyChecked = allIds.some((id) => current.has(id));
      const nextSet = anyChecked ? new Set<string>() : new Set(allIds);
      return { ...prev, [event.id]: nextSet };
    });
  };

  const selectTargets = (event: MatchEvent, ids: string[]) =>
    setCheckedTargets((prev) => ({ ...prev, [event.id]: new Set(ids) }));

  const expandTargets = (eventId: string) =>
    setExpandedEvents((prev) => new Set(prev).add(eventId));

  // Dismiss event (Update status to dismissed)
  const handleDismiss = async (eventId: string) => {
    setDismissingId(eventId);
    try {
      const db = createClient();
      const { error } = await db
        .from('match_events')
        .update({ status: 'dismissed' })
        .eq('id', eventId);
      if (error) throw error;

      removeEvent(eventId);
      toast.success('Event dismissed');
    } catch (err: unknown) {
      console.error('[radar] dismiss failed:', err);
      toast.error('Failed to dismiss event');
    } finally {
      setDismissingId(null);
    }
  };

  // Trigger Send Match Alert API
  const handleSend = async (event: MatchEvent) => {
    const selectedIds = Array.from(selectionFor(event));
    if (selectedIds.length === 0) {
      toast.error('Please select at least one match target to send');
      return;
    }

    setSendingId(event.id);
    try {
      const manualIds = new Set(
        (manualContacts[event.id] ?? []).map((contact) => contact.id)
      );
      const res = await fetch('/api/radar/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          targetIds: selectedIds,
          manualContactIds: selectedIds.filter((id) => manualIds.has(id)),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Broadcast dispatch failed');
      }

      const { sent, sentViaTemplate, templateMissing, failed, results } = data;
      setAlertTemplateStatus(data.alertTemplateStatus ?? null);

      // Handle outcomes
      if (sent > 0) {
        toast.success(
          sentViaTemplate > 0
            ? `Sent ${sent} WhatsApp alert${sent === 1 ? '' : 's'} — ${sentViaTemplate} via the approved template (outside the 24h window).`
            : `Successfully sent WhatsApp alerts to ${sent} contact${sent === 1 ? '' : 's'}!`
        );
      }
      if (failed > 0) {
        toast.error(`Failed to send alerts to ${failed} contacts.`);
      }

      if (templateMissing > 0) {
        // Contacts outside the 24h window with no approved template yet.
        const missingDetails = (
          results as Array<{ id: string; status: string }>
        )
          .filter((r) => r.status === 'templateMissing')
          .map((r) => {
            const matchInfo = event.matches.find((m) => m.id === r.id);
            const manualInfo = (manualContacts[event.id] ?? []).find(
              (contact) => contact.id === r.id
            );
            return {
              id: r.id,
              name:
                matchInfo?.name ||
                [manualInfo?.name, manualInfo?.second_name]
                  .filter(Boolean)
                  .join(' ') ||
                manualInfo?.phone ||
                'Unknown target',
            };
          });

        setTemplateMissingTargets((prev) => ({
          ...prev,
          [event.id]: missingDetails,
        }));

        toast.warning(
          `${templateMissing} contact${templateMissing === 1 ? '' : 's'} need${templateMissing === 1 ? 's' : ''} the one-time template setup below.`
        );
      }

      // If everything was sent successfully, refresh feed (or auto-remove card if status is updated to sent)
      if (sent > 0 && templateMissing === 0) {
        removeEvent(event.id);
      }
    } catch (err: unknown) {
      console.error('[radar] send failed:', err);
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to process match broadcast';
      toast.error(msg);
    } finally {
      setSendingId(null);
    }
  };

  // One-click create/resubmit of the property-details template. After
  // Meta approves it (minutes to a few hours), Send Match Alert reaches
  // out-of-window contacts automatically — no manual fallback.
  const handleSubmitAlertTemplate = async () => {
    setSubmittingAlertTemplate(true);
    try {
      const payload = buildPropertyAlertTemplatePayload(window.location.origin);
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      setAlertTemplateStatus('PENDING');
      toast.success(
        'Template submitted to Meta — once approved, hit Send Match Alert again and these contacts go out automatically.'
      );
    } catch (err) {
      console.error('[radar] template submit failed:', err);
      toast.error(
        err instanceof Error ? err.message : 'Template submission failed'
      );
    } finally {
      setSubmittingAlertTemplate(false);
    }
  };

  const formatPrice = (p: Property) => {
    const val = Number(p.price);
    if (!val || isNaN(val)) return 'Not specified';
    return formatInrCompact(val);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-white">
            <Radar className="text-primary size-8" />
            Match Radar
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Proactive buyer-to-inventory matcher. The radar captures fresh
            listings and buyer preference changes, recommending high-intent
            broadcast queues.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refreshFeed()}
          disabled={!accountId || eventsQuery.isFetching}
          className="shrink-0 cursor-pointer rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-900/40 hover:text-white"
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${eventsQuery.isFetching ? 'animate-spin' : ''}`}
          />
          Refresh Feed
        </Button>
      </div>

      {eventsQuery.isPending ? (
        <TabSkeleton label="Loading Match Radar" />
      ) : !events || events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/10 py-16 text-center">
          <Radar className="text-slate-650 mx-auto mb-3 size-12 animate-pulse" />
          <p className="text-sm font-bold text-slate-400">Match Radar clear</p>
          <p className="text-slate-550 mx-auto mt-1 max-w-md text-xs">
            Radar checks for matches automatically when new properties are added
            or when buyers edit their search preferences.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Direct Owner properties (Owners Den deal_mode events) —
              cross-tenant masked cards with the credits unlock gate. */}
          {events
            .filter((evt) => evt.source === 'deal_mode')
            .map((evt) => (
              <DirectOwnerCard
                key={evt.id}
                event={evt}
                onDismiss={handleDismiss}
                dismissing={dismissingId === evt.id}
              />
            ))}
          {events
            .filter((evt) => evt.source !== 'deal_mode')
            .map((evt) => {
              const addedContacts = manualContacts[evt.id] ?? [];
              const displayTargets = [
                ...evt.matches.map((match) => ({
                  ...match,
                  manuallyAdded: false as const,
                })),
                ...addedContacts.map((contact) => ({
                  id: contact.id,
                  name:
                    [contact.name, contact.second_name]
                      .filter(Boolean)
                      .join(' ') || contact.phone,
                  detail: contact.phone,
                  score: null,
                  chips: [] as string[],
                  manuallyAdded: true as const,
                })),
              ];
              const allTargetIds = displayTargets.map((target) => target.id);
              const strongTargetIds = [
                ...defaultSelectedTargetIds(evt.matches),
                ...addedContacts.map((contact) => contact.id),
              ];
              const selectedIds = selectionFor(evt);
              const hasWeakTargets =
                strongTargetIds.length < allTargetIds.length;
              const isStrongOnly =
                selectedIds.size === strongTargetIds.length &&
                strongTargetIds.every((id) => selectedIds.has(id));
              const expanded = expandedEvents.has(evt.id);
              const visibleTargets = expanded
                ? displayTargets
                : displayTargets.slice(0, TARGET_PREVIEW_COUNT);

              return (
                <div
                  key={evt.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
                >
                  {/* Header Strip */}
                  <div className="border-slate-850 flex flex-wrap items-center justify-between gap-2 border-b bg-slate-950/45 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          evt.kind === 'new_property'
                            ? 'border-purple-500/20 bg-purple-500/10 text-purple-400'
                            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {evt.kind === 'new_property'
                          ? 'New Listing Radar'
                          : 'Buyer Preference Update'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500">
                        {format(new Date(evt.created_at), 'd MMM, h:mm aaa')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismiss(evt.id)}
                        disabled={
                          dismissingId === evt.id || sendingId === evt.id
                        }
                        title="Hide this alert"
                        className="h-7 cursor-pointer rounded-lg px-2 text-[11px] font-bold text-slate-400 hover:bg-slate-900 hover:text-rose-400"
                      >
                        <X className="mr-1 size-3" />
                        Dismiss
                      </Button>
                    </div>
                  </div>

                  <div className="grid flex-1 grid-cols-1 gap-5 p-5 md:grid-cols-12">
                    {/* Left Column: The Triggering Subject */}
                    <div className="space-y-3 border-b border-slate-800 pb-4 md:col-span-4 md:border-r md:border-b-0 md:pr-5 md:pb-0">
                      <h3 className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                        Subject
                        <InfoHint text="The item that triggered this radar alert — either a newly created property listing, or a contact whose buying criteria were updated." />
                      </h3>

                      {evt.kind === 'new_property' && evt.property ? (
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <Building className="text-primary mt-0.5 size-4.5 shrink-0" />
                            <div className="min-w-0">
                              <h4 className="text-sm leading-tight font-black text-white">
                                {evt.property.title}
                              </h4>
                              <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                                {evt.property.property_code || 'No code'}
                              </p>
                            </div>
                          </div>
                          <div className="border-slate-850 space-y-1 rounded-lg border bg-slate-950/20 p-2.5 text-xs">
                            <p className="font-semibold text-slate-300">
                              Price:{' '}
                              <span className="text-slate-200">
                                {formatPrice(evt.property)}
                              </span>
                            </p>
                            <p className="text-slate-350">
                              Location:{' '}
                              {evt.property.sublocality ||
                                evt.property.city ||
                                evt.property.location}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {evt.property.bedrooms
                                ? `${evt.property.bedrooms} BHK · `
                                : ''}
                              {evt.property.area_sqft
                                ? `${evt.property.area_sqft} ${evt.property.area_unit || 'Sq.Ft.'}`
                                : ''}
                            </p>
                          </div>
                          {isImplausibleListingPrice(evt.property) && (
                            <p className="flex items-start gap-1.5 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-snug font-semibold text-amber-400">
                              <AlertTriangle className="mt-px size-3.5 shrink-0" />
                              <span>
                                Price looks wrong, check the listing before
                                alerting.{' '}
                                <Link
                                  href={`/inventory?propertyId=${encodeURIComponent(evt.property.id)}`}
                                  className="font-bold text-amber-300 underline underline-offset-2 hover:text-amber-200"
                                >
                                  Open listing
                                </Link>
                              </span>
                            </p>
                          )}
                        </div>
                      ) : evt.kind === 'buyer_updated' && evt.contact ? (
                        (() => {
                          const source = resolveRequirementSource(evt.contact);
                          const budgetSource =
                            source.pref_budget_max ?? source.max_budget;
                          const areaHints = Array.from(
                            new Set([
                              ...(source.areas_of_interest ?? []),
                              ...(source.pref_areas ?? []),
                            ])
                          );
                          return (
                            <div className="space-y-2">
                              <div className="flex items-start gap-2">
                                <User className="text-primary mt-0.5 size-4.5 shrink-0" />
                                <div className="min-w-0">
                                  <h4 className="flex items-center gap-1.5 text-sm leading-tight font-black text-white">
                                    {source.name || source.phone}
                                    <NameTagBadge tag={source.name_tag} />
                                  </h4>
                                  <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                                    {source.phone}
                                  </p>
                                </div>
                              </div>
                              <div className="border-slate-850 space-y-1 rounded-lg border bg-slate-950/20 p-2.5 text-xs">
                                <p className="font-semibold text-slate-300">
                                  Budget:{' '}
                                  <span className="text-slate-200">
                                    {source.no_budget
                                      ? 'No limit'
                                      : budgetSource
                                        ? formatPrice({
                                            price: budgetSource,
                                          } as Property)
                                        : 'Not specified'}
                                  </span>
                                </p>
                                {areaHints.length > 0 && (
                                  <p className="text-slate-350">
                                    Areas: {areaHints.slice(0, 3).join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <p className="text-xs text-slate-500 italic">
                          Subject details no longer available
                        </p>
                      )}
                    </div>

                    {/* Right Column: The Matched Targets Feed */}
                    <div className="flex flex-col justify-between space-y-4 md:col-span-8">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                            Matching Targets ({displayTargets.length})
                            <InfoHint text="The corresponding items that match the Subject's criteria. For a new property, these are buyers whose budgets and preferred areas match. For a buyer update, these are properties that match their preferences." />
                          </h3>
                          <div className="flex items-center gap-2">
                            {evt.kind === 'new_property' && (
                              <ManualContactPicker
                                eventId={evt.id}
                                matchedCount={evt.matches.length}
                                value={addedContacts}
                                onChange={(contacts) =>
                                  updateManualContacts(evt, contacts)
                                }
                              />
                            )}
                            {hasWeakTargets && (
                              <button
                                type="button"
                                onClick={() =>
                                  selectTargets(
                                    evt,
                                    isStrongOnly
                                      ? allTargetIds
                                      : strongTargetIds
                                  )
                                }
                                className="text-primary cursor-pointer text-[11px] font-extrabold hover:underline"
                              >
                                {isStrongOnly
                                  ? 'Select all'
                                  : `Select ${DEFAULT_ALERT_MIN_SCORE}%+`}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleSelectAll(evt, allTargetIds)}
                              className="text-primary cursor-pointer text-[11px] font-extrabold hover:underline"
                            >
                              {selectedIds.size > 0
                                ? 'Deselect All'
                                : 'Select All'}
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {visibleTargets.map((match) => (
                            <MatchTargetRow
                              key={match.id}
                              density="compact"
                              name={match.name}
                              detail={match.detail}
                              scoreLabel={
                                match.manuallyAdded
                                  ? 'Added manually'
                                  : `${match.score}%`
                              }
                              tone={
                                match.manuallyAdded
                                  ? 'accent'
                                  : (match.score ?? 0) >= 70
                                    ? 'strong'
                                    : (match.score ?? 0) >= 30
                                      ? 'fair'
                                      : 'weak'
                              }
                              chips={
                                match.chips && match.chips.length > 0 ? (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {match.chips.slice(0, 2).map((chip) => (
                                      <span
                                        key={chip}
                                        className="py-0.2 rounded border border-slate-800 bg-slate-900 px-1 text-[8px] font-bold text-slate-400"
                                      >
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                ) : null
                              }
                              selected={selectedIds.has(match.id)}
                              onToggle={() => toggleTarget(evt, match.id)}
                            />
                          ))}
                        </div>
                        {!expanded &&
                          displayTargets.length > TARGET_PREVIEW_COUNT && (
                            <button
                              type="button"
                              onClick={() => expandTargets(evt.id)}
                              className="text-primary cursor-pointer text-[11px] font-extrabold hover:underline"
                            >
                              Show all {displayTargets.length}
                            </button>
                          )}
                      </div>

                      {/* One-time template setup — only shows when out-of-window
                        contacts couldn't be reached because the property-details template
                        isn't approved yet. Once it is, sends are automatic. */}
                      {templateMissingTargets[evt.id] &&
                        templateMissingTargets[evt.id].length > 0 && (
                          <div className="animate-fade-in space-y-2 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3.5">
                            <p className="flex items-center gap-1.5 text-[11px] leading-tight font-bold text-amber-400">
                              <AlertTriangle className="size-4 shrink-0" />
                              <span>
                                {templateMissingTargets[evt.id]
                                  .map((t) => t.name)
                                  .join(', ')}{' '}
                                {templateMissingTargets[evt.id].length === 1
                                  ? 'is'
                                  : 'are'}{' '}
                                outside the 24-hour WhatsApp window. Alerts to
                                them go out via the pre-approved{' '}
                                <code className="rounded bg-slate-950 px-1 py-0.5">
                                  {PROPERTY_ALERT_TEMPLATE_NAME}
                                </code>{' '}
                                template —{' '}
                                {alertTemplateStatus === 'PENDING'
                                  ? "yours is waiting for Meta approval. Hit Send Match Alert again once it's approved."
                                  : alertTemplateStatus === 'REJECTED'
                                    ? 'yours was rejected by Meta. Resubmit it below.'
                                    : "a one-time setup you haven't done yet."}
                              </span>
                            </p>
                            {alertTemplateStatus !== 'PENDING' && (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => void handleSubmitAlertTemplate()}
                                disabled={submittingAlertTemplate}
                                className="flex h-7 cursor-pointer items-center gap-1 rounded-lg border-amber-900 text-[10px] font-bold text-amber-300 hover:bg-amber-950/40"
                              >
                                {submittingAlertTemplate ? (
                                  <RefreshCw className="size-3 animate-spin" />
                                ) : (
                                  <Send className="size-3" />
                                )}
                                {alertTemplateStatus === 'REJECTED'
                                  ? 'Resubmit template'
                                  : 'Create & submit template'}
                              </Button>
                            )}
                          </div>
                        )}

                      {/* Action Strip */}
                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          size="sm"
                          disabled={
                            selectedIds.size === 0 || sendingId === evt.id
                          }
                          onClick={() => handleSend(evt)}
                          className="bg-primary hover:bg-primary/95 text-primary-foreground h-9 cursor-pointer rounded-xl px-4 text-xs font-semibold"
                        >
                          {sendingId === evt.id ? (
                            <>
                              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send className="mr-1.5 size-3.5" />
                              Send Match Alert ({selectedIds.size})
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
