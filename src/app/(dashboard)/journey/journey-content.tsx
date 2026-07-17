"use client";

/**
 * Journey Mind Map — page container.
 *
 * Owns everything stateful: which journey is open (?contact= /
 * ?property= in the URL so journeys deep-link from the contact panel
 * and the inbox), the account's stage list (seeded with the classic
 * Shared → … → Brokerage Paid funnel on first visit, mirroring how
 * the kanban seeds its default pipeline), the item rows, and every
 * mutation (add / advance / move / drop / reactivate / remove — each
 * writing a journey_events audit row). The canvas, sheet and dialogs
 * are presentation-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Building2,
  Import,
  Inbox,
  MessagesSquare,
  SlidersHorizontal,
  UserRound,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import { SearchableContactSelect } from "@/components/ui/searchable-contact-select";
import { SearchablePropertySelect } from "@/components/ui/searchable-property-select";
import { FavoriteButton } from "@/components/layout/favorite-button";
import type {
  Contact,
  JourneyEventType,
  JourneyItem,
  JourneyItemSource,
  JourneyStage,
  Property,
} from "@/types";
import {
  captureJourneyItems,
  ensureJourneyStages,
} from "@/lib/journey/capture";
import { scanMessagesForProperties } from "@/lib/journey/chat-scan";
import { JourneyCanvas } from "@/components/journey/journey-canvas";
import { JourneyItemSheet } from "@/components/journey/journey-item-sheet";
import { AddItemsDialog } from "@/components/journey/add-items-dialog";
import { CapturedTrayDialog } from "@/components/journey/captured-tray-dialog";
import { StageEditorDialog } from "@/components/journey/stage-editor-dialog";
import { type JourneyMode } from "@/components/journey/shared";

export default function JourneyPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, accountId } = useAuth();
  const canEdit = useCan("send-messages");

  const contactParam = searchParams.get("contact");
  const propertyParam = searchParams.get("property");
  const mode: JourneyMode = propertyParam ? "property" : "buyer";
  const subjectId = propertyParam ?? contactParam;

  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [subjectContact, setSubjectContact] = useState<Contact | null>(null);
  const [subjectProperty, setSubjectProperty] = useState<Property | null>(null);
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [currency, setCurrency] = useState("INR");

  // Picker state (no subject in the URL yet)
  const [pickerContacts, setPickerContacts] = useState<Contact[]>([]);
  const [pickerProperties, setPickerProperties] = useState<Property[]>([]);
  const [pickerLoaded, setPickerLoaded] = useState(false);

  // UI state
  const [selectedItem, setSelectedItem] = useState<JourneyItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [stageEditorOpen, setStageEditorOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [importableCount, setImportableCount] = useState(0);
  const [scanningChat, setScanningChat] = useState(false);

  // Guard against StrictMode double-seed, like the kanban does.
  const seedAttempted = useRef(false);

  // ── Currency (shared convention with the pipeline board) ────
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("showcase_settings")
        .select("currency")
        .eq("account_id", accountId)
        .maybeSingle();
      if (!cancelled && data?.currency) setCurrency(data.currency);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  // ── Stages: load + seed-if-empty ─────────────────────────────
  const loadStages = useCallback(async () => {
    const { data, error } = await supabase
      .from("journey_stages")
      .select("*")
      .order("position");
    if (error) {
      console.error("Failed to load journey stages:", error.message);
      return [];
    }
    return (data ?? []) as JourneyStage[];
  }, [supabase]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setStagesLoading(true);
      // ensureJourneyStages seeds the defaults on first visit — same
      // helper the WhatsApp share capture uses, so both paths agree.
      let list: JourneyStage[];
      if (!seedAttempted.current) {
        seedAttempted.current = true;
        list = await ensureJourneyStages(accountId);
      } else {
        list = await loadStages();
      }
      if (!cancelled) {
        setStages(list);
        setStagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadStages]);

  const refreshStages = useCallback(async () => {
    setStages(await loadStages());
  }, [loadStages]);

  // ── Subject + items ──────────────────────────────────────────
  const loadJourney = useCallback(async () => {
    if (!subjectId) return;
    setItemsLoading(true);
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
      setSubjectProperty(null);
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
      setSubjectContact(null);
      setItems((rows ?? []) as JourneyItem[]);
    }
    setItemsLoading(false);
  }, [subjectId, mode, supabase]);

  useEffect(() => {
    setSelectedItem(null);
    if (subjectId) {
      Promise.resolve().then(() => loadJourney());
    } else {
      Promise.resolve().then(() => {
        setItems([]);
        setSubjectContact(null);
        setSubjectProperty(null);
      });
    }
  }, [subjectId, loadJourney]);

  // Keep the open sheet in sync after a mutation refreshed `items`.
  // An item that got hidden mid-view closes the sheet — it's no
  // longer on the canvas the sheet was opened from.
  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items.find((i) => i.id === selectedItem.id);
    if (!fresh || fresh.hidden) setSelectedItem(null);
    else if (fresh !== selectedItem) setSelectedItem(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Import candidates: property inquiries not yet on the map ──
  useEffect(() => {
    if (mode !== "buyer" || !subjectId) {
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
      const fresh = (data ?? []).filter((r) => !existing.has(r.property_id));
      setImportableCount(fresh.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, subjectId, items, supabase]);

  // ── Picker data (only when no subject picked yet) ─────────────
  useEffect(() => {
    if (subjectId || !accountId || pickerLoaded) return;
    let cancelled = false;
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, name_tag")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("properties")
          .select("id, title, property_code, location, sublocality, project")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (cancelled) return;
      setPickerContacts((cs ?? []) as Contact[]);
      setPickerProperties((ps ?? []) as Property[]);
      setPickerLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectId, accountId, pickerLoaded, supabase]);

  // ── Mutations ────────────────────────────────────────────────

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

  const handleAddItems = useCallback(
    async (ids: string[], source: JourneyItemSource = "manual") => {
      if (!accountId || !subjectId) return;
      const { created, error } = await captureJourneyItems({
        accountId,
        userId: user?.id,
        pairs: ids.map((id) => ({
          contactId: mode === "buyer" ? subjectId : id,
          propertyId: mode === "buyer" ? id : subjectId,
        })),
        source,
        // Explicit user action → straight onto the map. Only silent
        // background capture (WhatsApp shares) arrives hidden.
        hidden: false,
      });
      if (error) {
        toast.error(`Failed to add: ${error}`);
        return;
      }
      if (created === 0) {
        toast.info("Already on the journey — nothing new to add.");
        await loadJourney();
        return;
      }
      toast.success(
        `Added ${created} ${mode === "buyer" ? "propert" : "contact"}${
          created === 1 ? (mode === "buyer" ? "y" : "") : mode === "buyer" ? "ies" : "s"
        }`,
      );
      await loadJourney();
    },
    [accountId, subjectId, mode, user?.id, loadJourney],
  );

  const handleImportInquiries = useCallback(async () => {
    if (mode !== "buyer" || !subjectId) return;
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

  // Retroactive sweep: scan the contact's WhatsApp history for
  // property links / codes / titles and put the hits on the map.
  // Explicitly clicked, so results land visible (not in the tray).
  const handleImportFromChat = useCallback(async () => {
    if (mode !== "buyer" || !subjectId || !accountId || scanningChat) return;
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
        .update({ stage_id: toStageId, status: "active", drop_reason: null, dropped_at: null })
        .eq("id", item.id);
      if (error) {
        toast.error(`Failed to move: ${error.message}`);
        return;
      }
      await logEvent(item.id, eventType, item.stage_id, toStageId);
      await loadJourney();
    },
    [supabase, logEvent, loadJourney],
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
      await loadJourney();
    },
    [supabase, logEvent, loadJourney],
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
      await loadJourney();
    },
    [supabase, logEvent, loadJourney],
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
      await loadJourney();
    },
    [supabase, loadJourney],
  );

  // ── Hide / unhide (Captured tray) ───────────────────────────

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
        await loadJourney();
      }
    },
    [setHiddenFlag, loadJourney],
  );

  const handleShow = useCallback(
    async (item: JourneyItem) => {
      if (await setHiddenFlag(item, false)) await loadJourney();
    },
    [setHiddenFlag, loadJourney],
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
    await loadJourney();
  }, [items, supabase, logEvent, loadJourney]);

  // ── Derived ─────────────────────────────────────────────────
  const existingIds = useMemo(
    () =>
      new Set(
        items.map((i) => (mode === "buyer" ? i.property_id : i.contact_id)),
      ),
    [items, mode],
  );

  // Hidden (captured) items wait in the tray; only visible ones render
  // on the canvas — that's what keeps daily share volume off the map.
  const visibleItems = useMemo(() => items.filter((i) => !i.hidden), [items]);
  const capturedItems = useMemo(() => items.filter((i) => i.hidden), [items]);

  const subjectName =
    mode === "buyer"
      ? subjectContact?.name || subjectContact?.phone
      : subjectProperty?.title;

  const openSubject = (nextMode: JourneyMode, id: string | null) => {
    if (!id) return;
    router.push(
      nextMode === "buyer" ? `/journey?contact=${id}` : `/journey?property=${id}`,
      { scroll: false },
    );
  };

  // ── Render ──────────────────────────────────────────────────

  if (stagesLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
            <Waypoints className="h-7 w-7 text-primary" />
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Journey
            </span>
            <FavoriteButton label="Journey" href="/journey" icon="Waypoints" />
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {subjectId && subjectName
              ? mode === "buyer"
                ? `Every property on ${subjectName}'s journey — where each one stands, and where the rest fell off.`
                : `Every contact on this property's journey — who's still in the race for ${subjectName}.`
              : "Pick a buyer or a property to see its full funnel as a mind map."}
          </p>
        </div>

        {subjectId && (
          <div className="flex flex-wrap items-center gap-2">
            {capturedItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTrayOpen(true)}
                className="border border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
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
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                {scanningChat ? "Scanning chat…" : "Import from chat"}
              </Button>
            )}
            {mode === "buyer" && importableCount > 0 && canEdit && (
              <Button variant="ghost" size="sm" onClick={handleImportInquiries}>
                <Import className="h-3.5 w-3.5" />
                Import {importableCount} inquir{importableCount === 1 ? "y" : "ies"}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStageEditorOpen(true)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Customize stages
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/journey", { scroll: false })}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Switch journey
            </Button>
          </div>
        )}
      </div>

      {!subjectId ? (
        /* ── Subject picker ── */
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                <UserRound className="h-4 w-4 text-primary" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-white">Buyer journey</h2>
                <p className="text-[11px] text-slate-400">
                  One buyer, every property shared with them.
                </p>
              </div>
            </div>
            <SearchableContactSelect
              contacts={pickerContacts.map((c) => ({
                id: c.id,
                name: c.name ?? c.phone,
                phone: c.phone,
                name_tag: c.name_tag,
              }))}
              value={null}
              onChange={(id) => openSubject("buyer", id)}
              placeholder={pickerLoaded ? "Select a contact…" : "Loading contacts…"}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                <Building2 className="h-4 w-4 text-primary" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-white">Property journey</h2>
                <p className="text-[11px] text-slate-400">
                  One property, every interested contact.
                </p>
              </div>
            </div>
            <SearchablePropertySelect
              properties={pickerProperties}
              value={null}
              onChange={(id) => openSubject("property", id)}
              placeholder={pickerLoaded ? "Select a property…" : "Loading properties…"}
            />
          </div>
        </div>
      ) : itemsLoading && items.length === 0 ? (
        <div className="flex h-[50vh] items-center justify-center rounded-xl border border-slate-800 bg-slate-950">
          <ConvoRealLoader />
        </div>
      ) : (
        <JourneyCanvas
          key={`${mode}:${subjectId}`}
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
        />
      )}

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

      <AddItemsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode={mode}
        accountId={accountId}
        existingIds={existingIds}
        currency={currency}
        onAdd={handleAddItems}
      />

      <StageEditorDialog
        open={stageEditorOpen}
        onOpenChange={setStageEditorOpen}
        accountId={accountId}
        stages={stages}
        onChanged={refreshStages}
      />
    </div>
  );
}
