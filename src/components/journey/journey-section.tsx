'use client';

/**
 * One complete journey — data, mutations, canvas, and dialogs — for a
 * single subject (a buyer contact, or a property in seller mode).
 *
 * Three hosts render this:
 *   - the focused view (/journey?contact= / ?property=) with
 *     variant "full" (viewport-height canvas)
 *   - the all-journeys overview, which stacks one embedded section
 *     per subject, each expanding lazily
 *   - that overview's full-screen overlay, variant "fullscreen",
 *     where one journey owns the whole viewport
 *
 * Everything per-subject lives here: item rows, advance / move /
 * drop / reactivate / remove / hide, the Captured tray, the add
 * picker, chat-history + inquiry imports. Only the stage list, the
 * stage editor, currency, and routing stay with the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Import,
  Inbox,
  MessagesSquare,
  NotebookPen,
  Plus,
  UserRound,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { brokerageAmount, type BrokerageType } from '@/lib/pipelines/brokerage';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { formatCurrencyShort } from '@/lib/currency-utils';
import type {
  Contact,
  JourneyEventType,
  JourneyItem,
  JourneyItemSource,
  JourneyStage,
  Property,
} from '@/types';
import { captureJourneyItems } from '@/lib/journey/capture';
import { scanMessagesForProperties } from '@/lib/journey/chat-scan';
import { JourneyCanvas } from './journey-canvas';
import { JourneyItemSheet } from './journey-item-sheet';
import { AddItemsDialog } from './add-items-dialog';
import { CapturedTrayDialog } from './captured-tray-dialog';
import { ContactNotesDialog } from './contact-notes-dialog';
import { splitItemsAtStage, type JourneyMode } from './shared';

export interface JourneySectionProps {
  mode: JourneyMode;
  subjectId: string;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  /** "full" fills the viewport (focused page); "embedded" renders a
   *  fixed-height band inside the overview list; "fullscreen" is the
   *  overview's expanded overlay, which has no page chrome to leave
   *  room for. */
  variant: 'full' | 'embedded' | 'fullscreen';
  /** Instant paint for the overview — the section still refetches the
   *  complete row in the background. */
  preloadedContact?: Contact | null;
  preloadedProperty?: Property | null;
  /** Fired after any mutation that changes item rows, so the overview
   *  can refresh its count chips. */
  onItemsChanged?: () => void;
  /** Stage the overview group is named after: items resting there lead
   *  the map, the rest fold behind a count until asked for. */
  focusStageId?: string | null;
  /** The group is the lost stage: dropped items lead instead of live
   *  ones. */
  focusDropped?: boolean;
}

export function JourneySection({
  mode,
  subjectId,
  stages,
  currency,
  canEdit,
  variant,
  preloadedContact,
  preloadedProperty,
  onItemsChanged,
  focusStageId = null,
  focusDropped = false,
}: JourneySectionProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [subjectContact, setSubjectContact] = useState<Contact | null>(
    preloadedContact ?? null
  );
  const [subjectProperty, setSubjectProperty] = useState<Property | null>(
    preloadedProperty ?? null
  );
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  const [selectedItem, setSelectedItem] = useState<JourneyItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [importableCount, setImportableCount] = useState(0);
  const [scanningChat, setScanningChat] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState(0);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const [brokeragePrompt, setBrokeragePrompt] = useState<{
    item: JourneyItem;
    toStageId: string;
    eventType: 'advanced' | 'moved';
    stageName: string;
    dealValue: number;
  } | null>(null);
  const [brokerageType, setBrokerageType] =
    useState<BrokerageType>('percentage');
  const [brokerageValue, setBrokerageValue] = useState('');

  // ── Load subject + items ─────────────────────────────────────
  const loadJourney = useCallback(async () => {
    if (mode === 'buyer') {
      const [{ data: c }, { data: rows }] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', subjectId).maybeSingle(),
        supabase
          .from('journey_items')
          .select('*, property:properties(*)')
          .eq('contact_id', subjectId)
          .order('created_at'),
      ]);
      setSubjectContact((c as Contact) ?? null);
      setItems((rows ?? []) as JourneyItem[]);
    } else {
      const [{ data: p }, { data: rows }] = await Promise.all([
        supabase
          .from('properties')
          .select('*')
          .eq('id', subjectId)
          .maybeSingle(),
        supabase
          .from('journey_items')
          .select('*, contact:contacts(*)')
          .eq('property_id', subjectId)
          .order('created_at'),
      ]);
      setSubjectProperty((p as Property) ?? null);
      setItems((rows ?? []) as JourneyItem[]);
    }
    setItemsLoading(false);
  }, [subjectId, mode, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => loadJourney());
  }, [loadJourney]);

  // Refresh + notify the host after any mutation.
  const refresh = useCallback(async () => {
    await loadJourney();
    onItemsChanged?.();
  }, [loadJourney, onItemsChanged]);

  // Keep the open sheet in sync after a refresh; close it if the item
  // vanished or was hidden off the canvas.
  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items.find((i) => i.id === selectedItem.id);
    if (!fresh || fresh.hidden) setSelectedItem(null);
    else if (fresh !== selectedItem) setSelectedItem(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Importable inquiries (buyer mode) ────────────────────────
  useEffect(() => {
    if (mode !== 'buyer') {
      Promise.resolve().then(() => setImportableCount(0));
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('contact_property_inquiries')
        .select('property_id')
        .eq('contact_id', subjectId);
      if (cancelled) return;
      const existing = new Set(items.map((i) => i.property_id));
      setImportableCount(
        (data ?? []).filter((r) => !existing.has(r.property_id)).length
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, subjectId, items, supabase]);

  // ── Contact note count (buyer mode) ──────────────────────────
  useEffect(() => {
    if (mode !== 'buyer') {
      Promise.resolve().then(() => setNotesCount(0));
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('contact_notes')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', subjectId);
      if (!cancelled) setNotesCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, subjectId, supabase]);

  // ── Event log helper ─────────────────────────────────────────
  const logEvent = useCallback(
    async (
      itemId: string,
      eventType: JourneyEventType,
      fromStageId: string | null,
      toStageId: string | null,
      reason?: string
    ) => {
      if (!accountId) return;
      const { error } = await supabase.from('journey_events').insert({
        account_id: accountId,
        item_id: itemId,
        event_type: eventType,
        from_stage_id: fromStageId,
        to_stage_id: toStageId,
        reason: reason ?? null,
        created_by: user?.id ?? null,
      });
      if (error) console.error('Failed to log journey event:', error.message);
    },
    [accountId, supabase, user?.id]
  );

  // ── Mutations ────────────────────────────────────────────────
  const handleAddItems = useCallback(
    async (ids: string[], source: JourneyItemSource = 'manual') => {
      if (!accountId) return;
      const { created, error } = await captureJourneyItems({
        accountId,
        userId: user?.id,
        pairs: ids.map((id) => ({
          contactId: mode === 'buyer' ? subjectId : id,
          propertyId: mode === 'buyer' ? id : subjectId,
        })),
        source,
        hidden: false,
      });
      if (error) {
        toast.error(`Failed to add: ${error}`);
        return;
      }
      if (created === 0) {
        toast.info('Already on the journey — nothing new to add.');
        await refresh();
        return;
      }
      toast.success(
        `Added ${created} ${mode === 'buyer' ? 'propert' : 'contact'}${
          created === 1
            ? mode === 'buyer'
              ? 'y'
              : ''
            : mode === 'buyer'
              ? 'ies'
              : 's'
        }`
      );
      await refresh();
    },
    [accountId, subjectId, mode, user?.id, refresh]
  );

  const handleImportInquiries = useCallback(async () => {
    if (mode !== 'buyer') return;
    const { data } = await supabase
      .from('contact_property_inquiries')
      .select('property_id')
      .eq('contact_id', subjectId);
    const existing = new Set(items.map((i) => i.property_id));
    const fresh = Array.from(
      new Set(
        (data ?? [])
          .map((r) => r.property_id as string)
          .filter((id) => !existing.has(id))
      )
    );
    if (fresh.length === 0) {
      toast.info('All inquiries are already on the map.');
      return;
    }
    await handleAddItems(fresh, 'inquiry_import');
  }, [mode, subjectId, items, supabase, handleAddItems]);

  const handleImportFromChat = useCallback(async () => {
    if (mode !== 'buyer' || !accountId || scanningChat) return;
    setScanningChat(true);
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', subjectId)
        .maybeSingle();
      if (!conv) {
        toast.info('No WhatsApp conversation with this contact yet.');
        return;
      }
      const [{ data: messages }, { data: props }] = await Promise.all([
        supabase
          .from('messages')
          .select('content_text, created_at')
          .eq('conversation_id', conv.id)
          .eq('sender_type', 'agent')
          .order('created_at', { ascending: false }),
        supabase
          .from('properties')
          .select('id, property_code, title')
          .eq('account_id', accountId)
          .limit(2000),
      ]);
      const found = scanMessagesForProperties(messages ?? [], props ?? []);
      const existing = new Set(items.map((i) => i.property_id));
      const fresh = Array.from(found.keys()).filter((id) => !existing.has(id));
      if (fresh.length === 0) {
        toast.info(
          found.size > 0
            ? 'Every property shared in chat is already on the journey.'
            : 'No shared properties found in the chat history.'
        );
        return;
      }
      await handleAddItems(fresh, 'chat_import');
    } finally {
      setScanningChat(false);
    }
  }, [
    mode,
    subjectId,
    accountId,
    scanningChat,
    supabase,
    items,
    handleAddItems,
  ]);

  // Every stage move goes through the journey move route: when the
  // stage mirrors a pipeline stage, the item's deal follows through the
  // same logic as the board (brokerage, closing record, property
  // status), and a move into the closing stretch opens the deal there.
  const moveItem = useCallback(
    async (
      item: JourneyItem,
      toStageId: string,
      eventType: 'advanced' | 'moved',
      brokerage?: { brokerage_type: BrokerageType; brokerage_value: number }
    ) => {
      setBrokeragePrompt(null);
      const res = await fetch('/api/journey/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          stage_id: toStageId,
          event_type: eventType,
          ...brokerage,
          source: 'web',
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        data?: { stage_name?: string; deal_value?: number };
      } | null;
      if (res.status === 409 && json?.code === 'BROKERAGE_REQUIRED') {
        setBrokerageType('percentage');
        setBrokerageValue('');
        setBrokeragePrompt({
          item,
          toStageId,
          eventType,
          stageName: json.data?.stage_name ?? '',
          dealValue: json.data?.deal_value ?? 0,
        });
        return false;
      }
      if (!res.ok) {
        toast.error(`Failed to move: ${json?.error ?? 'try again'}`);
        await refresh();
        return false;
      }
      await refresh();
      return true;
    },
    [refresh]
  );

  const handleAdvance = useCallback(
    (item: JourneyItem) => {
      const idx = stages.findIndex((s) => s.id === item.stage_id);
      const next = stages[idx + 1];
      if (!next) return;
      const stageName = next.name;
      // Only on a move that actually landed — otherwise the failure
      // toast above is immediately contradicted by a success one.
      moveItem(item, next.id, 'advanced').then((moved) => {
        if (moved) toast.success(`Moved to ${stageName}`);
      });
    },
    [stages, moveItem]
  );

  const handleMoveTo = useCallback(
    (item: JourneyItem, stageId: string) => {
      moveItem(item, stageId, 'moved');
    },
    [moveItem]
  );

  const handleDrop = useCallback(
    async (item: JourneyItem, reason: string) => {
      const { data: updated, error } = await supabase
        .from('journey_items')
        .update({
          status: 'dropped',
          drop_reason: reason,
          dropped_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .select('id');
      if (error || !updated?.length) {
        toast.error(
          `Failed to drop: ${error?.message ?? 'that item is no longer there'}`
        );
        return;
      }
      await logEvent(item.id, 'dropped', item.stage_id, item.stage_id, reason);
      await refresh();
    },
    [supabase, logEvent, refresh]
  );

  const handleReactivate = useCallback(
    async (item: JourneyItem) => {
      const { data: updated, error } = await supabase
        .from('journey_items')
        .update({ status: 'active', drop_reason: null, dropped_at: null })
        .eq('id', item.id)
        .select('id');
      if (error || !updated?.length) {
        toast.error(
          `Failed to reactivate: ${error?.message ?? 'that item is no longer there'}`
        );
        return;
      }
      await logEvent(item.id, 'reactivated', item.stage_id, item.stage_id);
      await refresh();
    },
    [supabase, logEvent, refresh]
  );

  const handleRemove = useCallback(
    async (item: JourneyItem) => {
      const { data: removed, error } = await supabase
        .from('journey_items')
        .delete()
        .eq('id', item.id)
        .select('id');
      if (error) {
        toast.error(`Failed to remove: ${error.message}`);
        return;
      }
      if (!removed?.length) {
        toast.error('Nothing was removed — reload and try again.');
        return;
      }
      setSelectedItem(null);
      await refresh();
    },
    [supabase, refresh]
  );

  const handlePlan = useCallback(
    async (item: JourneyItem, stageId: string, dateISO: string) => {
      const { data: updated, error } = await supabase
        .from('journey_items')
        .update({ planned_stage_id: stageId, planned_at: dateISO })
        .eq('id', item.id)
        .select('id');
      if (error || !updated?.length) {
        toast.error(
          `Failed to save plan: ${error?.message ?? 'that item is no longer there'}`
        );
        return;
      }
      await logEvent(
        item.id,
        'planned',
        item.stage_id,
        stageId,
        `Expected by ${dateISO}`
      );
      await refresh();
    },
    [supabase, logEvent, refresh]
  );

  const handleClearPlan = useCallback(
    async (item: JourneyItem) => {
      const { data: updated, error } = await supabase
        .from('journey_items')
        .update({ planned_stage_id: null, planned_at: null })
        .eq('id', item.id)
        .select('id');
      if (error || !updated?.length) {
        toast.error(
          `Failed to clear plan: ${error?.message ?? 'that item is no longer there'}`
        );
        return;
      }
      await logEvent(
        item.id,
        'plan_cleared',
        item.stage_id,
        item.planned_stage_id ?? null
      );
      await refresh();
    },
    [supabase, logEvent, refresh]
  );

  const setHiddenFlag = useCallback(
    async (item: JourneyItem, hidden: boolean) => {
      const { data: updated, error } = await supabase
        .from('journey_items')
        .update({ hidden })
        .eq('id', item.id)
        .select('id');
      if (error || !updated?.length) {
        toast.error(
          `Failed to update: ${error?.message ?? 'that item is no longer there'}`
        );
        return false;
      }
      await logEvent(
        item.id,
        hidden ? 'hidden' : 'unhidden',
        item.stage_id,
        item.stage_id
      );
      return true;
    },
    [supabase, logEvent]
  );

  const handleHide = useCallback(
    async (item: JourneyItem) => {
      if (await setHiddenFlag(item, true)) {
        setSelectedItem(null);
        toast.success('Hidden from the map — find it under Captured.');
        await refresh();
      }
    },
    [setHiddenFlag, refresh]
  );

  const showItems = useCallback(
    async (targets: JourneyItem[], failure: string) => {
      if (!accountId || targets.length === 0) return false;
      const { data: shown, error } = await supabase.rpc(
        'journey_show_captured',
        { p_account_id: accountId, p_item_ids: targets.map((i) => i.id) }
      );
      if (error || !shown?.length) {
        toast.error(
          `${failure}: ${error?.message ?? 'those items are no longer there'}`
        );
        return false;
      }
      return true;
    },
    [accountId, supabase]
  );

  const handleShow = useCallback(
    async (item: JourneyItem) => {
      if (await showItems([item], 'Failed to show')) await refresh();
    },
    [showItems, refresh]
  );

  const handleShowAll = useCallback(async () => {
    const hiddenItems = items.filter((i) => i.hidden);
    if (await showItems(hiddenItems, 'Failed to show all')) {
      setTrayOpen(false);
      await refresh();
    }
  }, [items, showItems, refresh]);

  // ── Derived ─────────────────────────────────────────────────
  const existingIds = useMemo(
    () =>
      new Set(
        items.map((i) => (mode === 'buyer' ? i.property_id : i.contact_id))
      ),
    [items, mode]
  );
  const visibleItems = useMemo(() => items.filter((i) => !i.hidden), [items]);
  const capturedItems = useMemo(() => items.filter((i) => i.hidden), [items]);
  const { atStage, elsewhere } = useMemo(
    () => splitItemsAtStage(visibleItems, focusStageId, focusDropped),
    [focusDropped, focusStageId, visibleItems]
  );
  const focusStage = stages.find((stage) => stage.id === focusStageId);
  const canvasItems = showElsewhere ? visibleItems : atStage;

  const hasToolbar =
    capturedItems.length > 0 ||
    canEdit ||
    mode === 'buyer' ||
    elsewhere.length > 0;

  const subjectTitle =
    mode === 'buyer'
      ? subjectContact?.name || subjectContact?.phone || 'Contact'
      : subjectProperty?.title || 'Property';
  const subjectSubtitle =
    mode === 'buyer'
      ? (subjectContact?.phone ?? '')
      : [
          subjectProperty?.property_code,
          subjectProperty?.location,
          subjectProperty?.price
            ? formatCurrencyShort(subjectProperty.price, currency)
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const toolbarButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      {elsewhere.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowElsewhere((current) => !current)}
          aria-pressed={showElsewhere}
          className="h-7 px-2.5 text-xs"
        >
          <Layers className="h-3.5 w-3.5" />
          {showElsewhere
            ? `Only ${focusStage?.name ?? 'this stage'}`
            : `${elsewhere.length} more at other stages`}
        </Button>
      )}
      {capturedItems.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTrayOpen(true)}
          className="h-7 border border-amber-500/30 bg-amber-500/5 px-2.5 text-xs text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
        >
          <Inbox className="h-3.5 w-3.5" />
          Captured ({capturedItems.length})
        </Button>
      )}
      {mode === 'buyer' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNotesOpen(true)}
          className="h-7 px-2.5 text-xs"
        >
          <NotebookPen className="h-3.5 w-3.5" />
          Notes{notesCount > 0 ? ` (${notesCount})` : ''}
        </Button>
      )}
      {mode === 'buyer' && canEdit && (
        <Button
          variant="ghost"
          size="sm"
          disabled={scanningChat}
          onClick={handleImportFromChat}
          className="h-7 px-2.5 text-xs"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          {scanningChat ? 'Scanning chat…' : 'Import from chat'}
        </Button>
      )}
      {mode === 'buyer' && importableCount > 0 && canEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleImportInquiries}
          className="h-7 px-2.5 text-xs"
        >
          <Import className="h-3.5 w-3.5" />
          Import {importableCount} inquir{importableCount === 1 ? 'y' : 'ies'}
        </Button>
      )}
      {canEdit && (
        <Button
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          {mode === 'buyer' ? 'Add properties' : 'Add contacts'}
        </Button>
      )}
    </div>
  );

  if (
    itemsLoading &&
    items.length === 0 &&
    !subjectContact &&
    !subjectProperty
  ) {
    return (
      <div
        className={
          variant === 'embedded'
            ? 'flex h-[200px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950'
            : 'flex h-[50vh] items-center justify-center rounded-xl border border-slate-800 bg-slate-950'
        }
      >
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {variant !== 'embedded' ? (
        // Subject bar — WHOSE journey this is, its live counts, and
        // every action in one row attached to the map (instead of
        // buttons scattered across disconnected header rows).
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              {mode === 'buyer' ? (
                <UserRound className="text-primary h-4 w-4" />
              ) : (
                <Building2 className="text-primary h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold text-white">
                  {subjectTitle}
                </span>
                {mode === 'buyer' && subjectContact?.name && (
                  <NameTagBadge tag={subjectContact.name_tag} />
                )}
                <span className="hidden shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 sm:inline">
                  {visibleItems.filter((i) => i.status === 'active').length}{' '}
                  active
                </span>
                {visibleItems.some((i) => i.status === 'dropped') && (
                  <span className="hidden shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300 sm:inline">
                    {visibleItems.filter((i) => i.status === 'dropped').length}{' '}
                    dropped
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-500">
                {subjectSubtitle}
              </p>
            </div>
          </div>
          {toolbarButtons}
        </div>
      ) : (
        hasToolbar && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {toolbarButtons}
          </div>
        )
      )}

      <JourneyCanvas
        mode={mode}
        contact={subjectContact}
        property={subjectProperty}
        stages={stages}
        items={canvasItems}
        currency={currency}
        canEdit={canEdit}
        selectedItemId={selectedItem?.id}
        highlightStageId={focusStageId}
        highlightDropped={focusDropped}
        onSelectItem={setSelectedItem}
        onAdvance={handleAdvance}
        onAddItems={() => setAddOpen(true)}
        capturedCount={capturedItems.length}
        onOpenCaptured={() => setTrayOpen(true)}
        heightClass={
          variant === 'fullscreen'
            ? 'h-[calc(100vh-150px)] min-h-[480px]'
            : variant === 'full'
              ? 'h-[calc(100vh-260px)] min-h-[480px]'
              : 'h-[420px]'
        }
      />

      <JourneyItemSheet
        item={selectedItem}
        mode={mode}
        stages={stages}
        currency={currency}
        canEdit={canEdit}
        contact={
          mode === 'buyer' ? subjectContact : (selectedItem?.contact ?? null)
        }
        property={
          mode === 'buyer' ? (selectedItem?.property ?? null) : subjectProperty
        }
        onClose={() => setSelectedItem(null)}
        onAdvance={handleAdvance}
        onMoveTo={handleMoveTo}
        onDrop={handleDrop}
        onReactivate={handleReactivate}
        onRemove={handleRemove}
        onHide={handleHide}
        onPlan={handlePlan}
        onClearPlan={handleClearPlan}
      />

      <AddItemsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode={mode}
        accountId={accountId}
        existingIds={existingIds}
        currency={currency}
        onAdd={(ids) => handleAddItems(ids)}
      />

      {mode === 'buyer' && (
        <ContactNotesDialog
          open={notesOpen}
          onOpenChange={setNotesOpen}
          contactId={subjectId}
          contactName={subjectTitle}
          canEdit={canEdit}
          onCountChange={setNotesCount}
        />
      )}

      <CapturedTrayDialog
        open={trayOpen}
        onOpenChange={setTrayOpen}
        mode={mode}
        items={capturedItems}
        currency={currency}
        canEdit={canEdit}
        onShow={handleShow}
        onShowAll={handleShowAll}
        onRemove={handleRemove}
      />

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
                {brokeragePrompt?.stageName}
              </span>{' '}
              starts the closing stretch. Record the brokerage rate or amount
              first, as the pipeline board does.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="jrn-brokerage-type" className="text-slate-300">
                  Brokerage type
                </Label>
                <select
                  id="jrn-brokerage-type"
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
                <Label htmlFor="jrn-brokerage-value" className="text-slate-300">
                  {brokerageType === 'percentage'
                    ? 'Brokerage (%)'
                    : 'Brokerage amount'}
                </Label>
                <Input
                  id="jrn-brokerage-value"
                  type="number"
                  min="0"
                  value={brokerageValue}
                  onChange={(e) => setBrokerageValue(e.target.value)}
                  placeholder={brokerageType === 'percentage' ? '2' : '0'}
                  className="border-slate-700 bg-slate-950 text-white"
                />
              </div>
            </div>
            {Number(brokerageValue) > 0 && brokeragePrompt && (
              <p className="text-primary text-[11px] font-semibold">
                Calculated brokerage: Rs.{' '}
                {formatIndianDigits(
                  brokerageAmount({
                    dealValue: brokeragePrompt.dealValue,
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
                void moveItem(
                  brokeragePrompt.item,
                  brokeragePrompt.toStageId,
                  brokeragePrompt.eventType,
                  {
                    brokerage_type: brokerageType,
                    brokerage_value: Number(brokerageValue),
                  }
                ).then((moved) => {
                  if (moved)
                    toast.success(`Moved to ${brokeragePrompt.stageName}`);
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
