"use client";

/**
 * One complete journey — data, mutations, canvas, and dialogs — for a
 * single subject (a buyer contact, or a property in seller mode).
 *
 * Two hosts render this:
 *   - the focused view (/journey?contact= / ?property=) with
 *     variant "full" (viewport-height canvas)
 *   - the all-journeys overview, which stacks one embedded section
 *     per subject, each expanding lazily
 *
 * Everything per-subject lives here: item rows, advance / move /
 * drop / reactivate / remove / hide, the Captured tray, the add
 * picker, chat-history + inquiry imports. Only the stage list, the
 * stage editor, currency, and routing stay with the page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Import, Inbox, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import type {
  Contact,
  JourneyEventType,
  JourneyItem,
  JourneyItemSource,
  JourneyStage,
  Property,
} from "@/types";
import { captureJourneyItems } from "@/lib/journey/capture";
import { scanMessagesForProperties } from "@/lib/journey/chat-scan";
import { JourneyCanvas } from "./journey-canvas";
import { JourneyItemSheet } from "./journey-item-sheet";
import { AddItemsDialog } from "./add-items-dialog";
import { CapturedTrayDialog } from "./captured-tray-dialog";
import type { JourneyMode } from "./shared";

export interface JourneySectionProps {
  mode: JourneyMode;
  subjectId: string;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  /** "full" fills the viewport (focused page); "embedded" renders a
   *  fixed-height band inside the overview list. */
  variant: "full" | "embedded";
  /** Instant paint for the overview — the section still refetches the
   *  complete row in the background. */
  preloadedContact?: Contact | null;
  preloadedProperty?: Property | null;
  /** Fired after any mutation that changes item rows, so the overview
   *  can refresh its count chips. */
  onItemsChanged?: () => void;
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
}: JourneySectionProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [subjectContact, setSubjectContact] = useState<Contact | null>(
    preloadedContact ?? null,
  );
  const [subjectProperty, setSubjectProperty] = useState<Property | null>(
    preloadedProperty ?? null,
  );
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  const [selectedItem, setSelectedItem] = useState<JourneyItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [importableCount, setImportableCount] = useState(0);
  const [scanningChat, setScanningChat] = useState(false);

  // ── Load subject + items ─────────────────────────────────────
  const loadJourney = useCallback(async () => {
    if (mode === "buyer") {
      const [{ data: c }, { data: rows }] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", subjectId).maybeSingle(),
        supabase
          .from("journey_items")
          .select("*, property:properties(*)")
          .eq("contact_id", subjectId)
          .order("created_at"),
      ]);
      setSubjectContact((c as Contact) ?? null);
      setItems((rows ?? []) as JourneyItem[]);
    } else {
      const [{ data: p }, { data: rows }] = await Promise.all([
        supabase.from("properties").select("*").eq("id", subjectId).maybeSingle(),
        supabase
          .from("journey_items")
          .select("*, contact:contacts(*)")
          .eq("property_id", subjectId)
          .order("created_at"),
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
    if (mode !== "buyer") {
      Promise.resolve().then(() => setImportableCount(0));
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("contact_property_inquiries")
        .select("property_id")
        .eq("contact_id", subjectId);
      if (cancelled) return;
      const existing = new Set(items.map((i) => i.property_id));
      setImportableCount(
        (data ?? []).filter((r) => !existing.has(r.property_id)).length,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, subjectId, items, supabase]);

  // ── Event log helper ─────────────────────────────────────────
  const logEvent = useCallback(
    async (
      itemId: string,
      eventType: JourneyEventType,
      fromStageId: string | null,
      toStageId: string | null,
      reason?: string,
    ) => {
      if (!accountId) return;
      const { error } = await supabase.from("journey_events").insert({
        account_id: accountId,
        item_id: itemId,
        event_type: eventType,
        from_stage_id: fromStageId,
        to_stage_id: toStageId,
        reason: reason ?? null,
        created_by: user?.id ?? null,
      });
      if (error) console.error("Failed to log journey event:", error.message);
    },
    [accountId, supabase, user?.id],
  );

  // ── Mutations ────────────────────────────────────────────────
  const handleAddItems = useCallback(
    async (ids: string[], source: JourneyItemSource = "manual") => {
      if (!accountId) return;
      const { created, error } = await captureJourneyItems({
        accountId,
        userId: user?.id,
        pairs: ids.map((id) => ({
          contactId: mode === "buyer" ? subjectId : id,
          propertyId: mode === "buyer" ? id : subjectId,
        })),
        source,
        hidden: false,
      });
      if (error) {
        toast.error(`Failed to add: ${error}`);
        return;
      }
      if (created === 0) {
        toast.info("Already on the journey — nothing new to add.");
        await refresh();
        return;
      }
      toast.success(
        `Added ${created} ${mode === "buyer" ? "propert" : "contact"}${
          created === 1 ? (mode === "buyer" ? "y" : "") : mode === "buyer" ? "ies" : "s"
        }`,
      );
      await refresh();
    },
    [accountId, subjectId, mode, user?.id, refresh],
  );

  const handleImportInquiries = useCallback(async () => {
    if (mode !== "buyer") return;
    const { data } = await supabase
      .from("contact_property_inquiries")
      .select("property_id")
      .eq("contact_id", subjectId);
    const existing = new Set(items.map((i) => i.property_id));
    const fresh = Array.from(
      new Set(
        (data ?? [])
          .map((r) => r.property_id as string)
          .filter((id) => !existing.has(id)),
      ),
    );
    if (fresh.length === 0) {
      toast.info("All inquiries are already on the map.");
      return;
    }
    await handleAddItems(fresh, "inquiry_import");
  }, [mode, subjectId, items, supabase, handleAddItems]);

  const handleImportFromChat = useCallback(async () => {
    if (mode !== "buyer" || !accountId || scanningChat) return;
    setScanningChat(true);
    try {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", subjectId)
        .maybeSingle();
      if (!conv) {
        toast.info("No WhatsApp conversation with this contact yet.");
        return;
      }
      const [{ data: messages }, { data: props }] = await Promise.all([
        supabase
          .from("messages")
          .select("content_text, created_at")
          .eq("conversation_id", conv.id)
          .eq("sender_type", "agent")
          .order("created_at", { ascending: false }),
        supabase
          .from("properties")
          .select("id, property_code, title")
          .eq("account_id", accountId)
          .limit(2000),
      ]);
      const found = scanMessagesForProperties(messages ?? [], props ?? []);
      const existing = new Set(items.map((i) => i.property_id));
      const fresh = Array.from(found.keys()).filter((id) => !existing.has(id));
      if (fresh.length === 0) {
        toast.info(
          found.size > 0
            ? "Every property shared in chat is already on the journey."
            : "No shared properties found in the chat history.",
        );
        return;
      }
      await handleAddItems(fresh, "chat_import");
    } finally {
      setScanningChat(false);
    }
  }, [mode, subjectId, accountId, scanningChat, supabase, items, handleAddItems]);

  const moveItem = useCallback(
    async (
      item: JourneyItem,
      toStageId: string,
      eventType: "advanced" | "moved",
    ) => {
      const { error } = await supabase
        .from("journey_items")
        .update({
          stage_id: toStageId,
          status: "active",
          drop_reason: null,
          dropped_at: null,
        })
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to move: ${error.message}`);
        return;
      }
      await logEvent(item.id, eventType, item.stage_id, toStageId);
      await refresh();
    },
    [supabase, logEvent, refresh],
  );

  const handleAdvance = useCallback(
    (item: JourneyItem) => {
      const idx = stages.findIndex((s) => s.id === item.stage_id);
      const next = stages[idx + 1];
      if (!next) return;
      const stageName = next.name;
      moveItem(item, next.id, "advanced").then(() =>
        toast.success(`Moved to ${stageName}`),
      );
    },
    [stages, moveItem],
  );

  const handleMoveTo = useCallback(
    (item: JourneyItem, stageId: string) => {
      moveItem(item, stageId, "moved");
    },
    [moveItem],
  );

  const handleDrop = useCallback(
    async (item: JourneyItem, reason: string) => {
      const { error } = await supabase
        .from("journey_items")
        .update({
          status: "dropped",
          drop_reason: reason,
          dropped_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to drop: ${error.message}`);
        return;
      }
      await logEvent(item.id, "dropped", item.stage_id, item.stage_id, reason);
      await refresh();
    },
    [supabase, logEvent, refresh],
  );

  const handleReactivate = useCallback(
    async (item: JourneyItem) => {
      const { error } = await supabase
        .from("journey_items")
        .update({ status: "active", drop_reason: null, dropped_at: null })
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to reactivate: ${error.message}`);
        return;
      }
      await logEvent(item.id, "reactivated", item.stage_id, item.stage_id);
      await refresh();
    },
    [supabase, logEvent, refresh],
  );

  const handleRemove = useCallback(
    async (item: JourneyItem) => {
      const { error } = await supabase
        .from("journey_items")
        .delete()
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to remove: ${error.message}`);
        return;
      }
      setSelectedItem(null);
      await refresh();
    },
    [supabase, refresh],
  );

  const setHiddenFlag = useCallback(
    async (item: JourneyItem, hidden: boolean) => {
      const { error } = await supabase
        .from("journey_items")
        .update({ hidden })
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to update: ${error.message}`);
        return false;
      }
      await logEvent(
        item.id,
        hidden ? "hidden" : "unhidden",
        item.stage_id,
        item.stage_id,
      );
      return true;
    },
    [supabase, logEvent],
  );

  const handleHide = useCallback(
    async (item: JourneyItem) => {
      if (await setHiddenFlag(item, true)) {
        setSelectedItem(null);
        toast.success("Hidden from the map — find it under Captured.");
        await refresh();
      }
    },
    [setHiddenFlag, refresh],
  );

  const handleShow = useCallback(
    async (item: JourneyItem) => {
      if (await setHiddenFlag(item, false)) await refresh();
    },
    [setHiddenFlag, refresh],
  );

  const handleShowAll = useCallback(async () => {
    const hiddenItems = items.filter((i) => i.hidden);
    if (hiddenItems.length === 0) return;
    const { error } = await supabase
      .from("journey_items")
      .update({ hidden: false })
      .in(
        "id",
        hiddenItems.map((i) => i.id),
      );
    if (error) {
      toast.error(`Failed to show all: ${error.message}`);
      return;
    }
    await Promise.all(
      hiddenItems.map((i) => logEvent(i.id, "unhidden", i.stage_id, i.stage_id)),
    );
    setTrayOpen(false);
    await refresh();
  }, [items, supabase, logEvent, refresh]);

  // ── Derived ─────────────────────────────────────────────────
  const existingIds = useMemo(
    () =>
      new Set(
        items.map((i) => (mode === "buyer" ? i.property_id : i.contact_id)),
      ),
    [items, mode],
  );
  const visibleItems = useMemo(() => items.filter((i) => !i.hidden), [items]);
  const capturedItems = useMemo(() => items.filter((i) => i.hidden), [items]);

  const hasToolbar =
    capturedItems.length > 0 || (mode === "buyer" && canEdit);

  if (itemsLoading && items.length === 0 && !subjectContact && !subjectProperty) {
    return (
      <div
        className={
          variant === "full"
            ? "flex h-[50vh] items-center justify-center rounded-xl border border-slate-800 bg-slate-950"
            : "flex h-[200px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950"
        }
      >
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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
          {mode === "buyer" && canEdit && (
            <Button
              variant="ghost"
              size="sm"
              disabled={scanningChat}
              onClick={handleImportFromChat}
              className="h-7 px-2.5 text-xs"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              {scanningChat ? "Scanning chat…" : "Import from chat"}
            </Button>
          )}
          {mode === "buyer" && importableCount > 0 && canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleImportInquiries}
              className="h-7 px-2.5 text-xs"
            >
              <Import className="h-3.5 w-3.5" />
              Import {importableCount} inquir{importableCount === 1 ? "y" : "ies"}
            </Button>
          )}
        </div>
      )}

      <JourneyCanvas
        mode={mode}
        contact={subjectContact}
        property={subjectProperty}
        stages={stages}
        items={visibleItems}
        currency={currency}
        canEdit={canEdit}
        selectedItemId={selectedItem?.id}
        onSelectItem={setSelectedItem}
        onAdvance={handleAdvance}
        onAddItems={() => setAddOpen(true)}
        capturedCount={capturedItems.length}
        onOpenCaptured={() => setTrayOpen(true)}
        heightClass={
          variant === "full"
            ? "h-[calc(100vh-260px)] min-h-[480px]"
            : "h-[420px]"
        }
      />

      <JourneyItemSheet
        item={selectedItem}
        mode={mode}
        stages={stages}
        currency={currency}
        canEdit={canEdit}
        onClose={() => setSelectedItem(null)}
        onAdvance={handleAdvance}
        onMoveTo={handleMoveTo}
        onDrop={handleDrop}
        onReactivate={handleReactivate}
        onRemove={handleRemove}
        onHide={handleHide}
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
    </div>
  );
}
