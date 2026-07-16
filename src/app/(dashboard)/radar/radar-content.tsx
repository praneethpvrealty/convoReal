"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Radar,
  RefreshCw,
  Send,
  Trash2,
  User,
  Building,
  AlertTriangle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { loadMatchEvents } from "@/lib/radar/queries";
import { buildPropertyAlertTemplatePayload } from "@/lib/whatsapp/property-alert-template";
import type { MatchEvent, Property } from "@/types";
import { InfoHint } from "@/components/ui/info-hint";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";
import { RadarSweepLoader } from "@/components/ui/radar-sweep-loader";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";

interface CheckedState {
  /** Event ID -> Set of target IDs. */
  [eventId: string]: Set<string>;
}

export default function RadarPage() {
  const { accountId } = useAuth();
  const [events, setEvents] = useState<MatchEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // Checked state for targets within each event card
  const [checkedTargets, setCheckedTargets] = useState<CheckedState>({});

  // Recipients that couldn't be reached because they're outside the 24h
  // window AND the new_property_alert template isn't approved yet —
  // sending is template-first, so this only appears until the one-time
  // template setup is done.
  const [templateMissingTargets, setTemplateMissingTargets] = useState<{
    [eventId: string]: Array<{ id: string; name: string }>;
  }>({});
  const [alertTemplateStatus, setAlertTemplateStatus] = useState<string | null>(null);
  const [submittingAlertTemplate, setSubmittingAlertTemplate] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const db = createClient();
      const data = await loadMatchEvents(db);
      setEvents(data);

      // Pre-select all target matches by default
      const initialChecked: CheckedState = {};
      data.forEach((evt) => {
        initialChecked[evt.id] = new Set(evt.matches.map((m) => m.id));
      });
      setCheckedTargets(initialChecked);
      setTemplateMissingTargets({});
    } catch (err: unknown) {
      console.error("[radar] fetch failed:", err);
      toast.error("Failed to load Match Radar feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) {
      fetchEvents();
    }
  }, [accountId, fetchEvents]);

  // Target checkbox toggle
  const toggleTarget = (eventId: string, targetId: string) => {
    setCheckedTargets((prev) => {
      const current = prev[eventId] ? new Set(prev[eventId]) : new Set<string>();
      if (current.has(targetId)) {
        current.delete(targetId);
      } else {
        current.add(targetId);
      }
      return { ...prev, [eventId]: current };
    });
  };

  // Select/Deselect all targets for a card
  const toggleSelectAll = (eventId: string, allIds: string[]) => {
    setCheckedTargets((prev) => {
      const current = prev[eventId] ? new Set(prev[eventId]) : new Set<string>();
      const allChecked = allIds.every((id) => current.has(id));
      const nextSet = allChecked ? new Set<string>() : new Set(allIds);
      return { ...prev, [eventId]: nextSet };
    });
  };

  // Dismiss event (Update status to dismissed)
  const handleDismiss = async (eventId: string) => {
    setDismissingId(eventId);
    try {
      const db = createClient();
      const { error } = await db
        .from("match_events")
        .update({ status: "dismissed" })
        .eq("id", eventId);
      if (error) throw error;

      setEvents((prev) => (prev ? prev.filter((e) => e.id !== eventId) : null));
      toast.success("Event dismissed");
    } catch (err: unknown) {
      console.error("[radar] dismiss failed:", err);
      toast.error("Failed to dismiss event");
    } finally {
      setDismissingId(null);
    }
  };

  // Trigger Send Match Alert API
  const handleSend = async (event: MatchEvent) => {
    const selectedIds = checkedTargets[event.id]
      ? Array.from(checkedTargets[event.id])
      : [];
    if (selectedIds.length === 0) {
      toast.error("Please select at least one match target to send");
      return;
    }

    setSendingId(event.id);
    try {
      const res = await fetch("/api/radar/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          targetIds: selectedIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Broadcast dispatch failed");
      }

      const { sent, sentViaTemplate, templateMissing, failed, results } = data;
      setAlertTemplateStatus(data.alertTemplateStatus ?? null);

      // Handle outcomes
      if (sent > 0) {
        toast.success(
          sentViaTemplate > 0
            ? `Sent ${sent} WhatsApp alert${sent === 1 ? "" : "s"} — ${sentViaTemplate} via the approved template (outside the 24h window).`
            : `Successfully sent WhatsApp alerts to ${sent} contact${sent === 1 ? "" : "s"}!`,
        );
      }
      if (failed > 0) {
        toast.error(`Failed to send alerts to ${failed} contacts.`);
      }

      if (templateMissing > 0) {
        // Contacts outside the 24h window with no approved template yet.
        const missingDetails = (results as Array<{ id: string; status: string }>)
          .filter((r) => r.status === "templateMissing")
          .map((r) => {
            const matchInfo = event.matches.find((m) => m.id === r.id);
            return {
              id: r.id,
              name: matchInfo ? matchInfo.name : "Unknown target",
            };
          });

        setTemplateMissingTargets((prev) => ({
          ...prev,
          [event.id]: missingDetails,
        }));

        toast.warning(
          `${templateMissing} contact${templateMissing === 1 ? "" : "s"} need${templateMissing === 1 ? "s" : ""} the one-time template setup below.`,
        );
      }

      // If everything was sent successfully, refresh feed (or auto-remove card if status is updated to sent)
      if (sent > 0 && templateMissing === 0) {
        setEvents((prev) => (prev ? prev.filter((e) => e.id !== event.id) : null));
      }
    } catch (err: unknown) {
      console.error("[radar] send failed:", err);
      const msg = err instanceof Error ? err.message : "Failed to process match broadcast";
      toast.error(msg);
    } finally {
      setSendingId(null);
    }
  };

  // One-click create/resubmit of the new_property_alert template. After
  // Meta approves it (minutes to a few hours), Send Match Alert reaches
  // out-of-window contacts automatically — no manual fallback.
  const handleSubmitAlertTemplate = async () => {
    setSubmittingAlertTemplate(true);
    try {
      const payload = buildPropertyAlertTemplatePayload(window.location.origin);
      const res = await fetch("/api/whatsapp/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Template submission failed");
      setAlertTemplateStatus("PENDING");
      toast.success(
        "Template submitted to Meta — once approved, hit Send Match Alert again and these contacts go out automatically.",
      );
    } catch (err) {
      console.error("[radar] template submit failed:", err);
      toast.error(err instanceof Error ? err.message : "Template submission failed");
    } finally {
      setSubmittingAlertTemplate(false);
    }
  };

  const formatPrice = (p: Property) => {
    const val = Number(p.price);
    if (!val || isNaN(val)) return "Not specified";
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, "")} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2).replace(/\.00$/, "")} L`;
    return `₹${val.toLocaleString("en-IN")}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Radar className="size-8 text-primary" />
            Match Radar
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Proactive buyer-to-inventory matcher. The radar captures fresh listings and buyer preference changes, recommending high-intent broadcast queues.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchEvents}
          disabled={loading}
          className="shrink-0 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900/40 rounded-xl cursor-pointer"
        >
          <RefreshCw className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Feed
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <RadarSweepLoader size={96} label="Scanning for matches" className="mb-3" />
          <ConvoRealLoader size={20} className="mb-2" />
          <p className="text-sm">Scanning for matches...</p>
        </div>
      ) : !events || events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center bg-slate-900/10">
          <Radar className="size-12 mx-auto text-slate-650 mb-3 animate-pulse" />
          <p className="text-sm font-bold text-slate-400">Match Radar clear</p>
          <p className="text-xs text-slate-550 mt-1 max-w-md mx-auto">
            Radar checks for matches automatically when new properties are added or when buyers edit their search preferences.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {events.map((evt) => {
            const allTargetIds = evt.matches.map((m) => m.id);
            const selectedIds = checkedTargets[evt.id] || new Set<string>();
            const isAllChecked = allTargetIds.every((id) => selectedIds.has(id));

            return (
              <div
                key={evt.id}
                className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden flex flex-col"
              >
                {/* Header Strip */}
                <div className="bg-slate-950/45 px-5 py-3 border-b border-slate-850 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        evt.kind === "new_property"
                          ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      }`}
                    >
                      {evt.kind === "new_property" ? "New Listing Radar" : "Buyer Preference Update"}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">
                      {new Date(evt.created_at).toLocaleDateString()} · {new Date(evt.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDismiss(evt.id)}
                      disabled={dismissingId === evt.id || sendingId === evt.id}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-lg h-7 px-2 cursor-pointer"
                    >
                      <Trash2 className="size-3 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 flex-1">
                  {/* Left Column: The Triggering Subject */}
                  <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-800 pb-4 md:pb-0 md:pr-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                      Subject
                      <InfoHint text="The item that triggered this radar alert — either a newly created property listing, or a contact whose buying criteria were updated." />
                    </h3>

                    {evt.kind === "new_property" && evt.property ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <Building className="size-4.5 text-primary shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-white leading-tight">
                              {evt.property.title}
                            </h4>
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                              {evt.property.property_code || "No code"}
                            </p>
                          </div>
                        </div>
                        <div className="bg-slate-950/20 rounded-lg p-2.5 space-y-1 text-xs border border-slate-850">
                          <p className="text-slate-300 font-semibold">
                            Price: <span className="text-slate-200">{formatPrice(evt.property)}</span>
                          </p>
                          <p className="text-slate-350">
                            Location: {evt.property.sublocality || evt.property.city || evt.property.location}
                          </p>
                          <p className="text-slate-400 text-[10px]">
                            {evt.property.bedrooms ? `${evt.property.bedrooms} BHK · ` : ""}
                            {evt.property.area_sqft ? `${evt.property.area_sqft} ${evt.property.area_unit || "Sq.Ft."}` : ""}
                          </p>
                        </div>
                      </div>
                    ) : evt.kind === "buyer_updated" && evt.contact ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <User className="size-4.5 text-primary shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-white leading-tight flex items-center gap-1.5">
                              {evt.contact.name || evt.contact.phone}
                              <NameTagBadge tag={evt.contact.name_tag} />
                            </h4>
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                              {evt.contact.phone}
                            </p>
                          </div>
                        </div>
                        <div className="bg-slate-950/20 rounded-lg p-2.5 space-y-1 text-xs border border-slate-850">
                          <p className="text-slate-300 font-semibold">
                            Budget:{" "}
                            <span className="text-slate-200">
                              {evt.contact.no_budget
                                ? "No limit"
                                : evt.contact.max_budget
                                  ? formatPrice({ price: evt.contact.max_budget } as Property)
                                  : "Not specified"}
                            </span>
                          </p>
                          {evt.contact.areas_of_interest && evt.contact.areas_of_interest.length > 0 && (
                            <p className="text-slate-350">
                              Areas: {evt.contact.areas_of_interest.slice(0, 3).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Subject details no longer available</p>
                    )}
                  </div>

                  {/* Right Column: The Matched Targets Feed */}
                  <div className="md:col-span-8 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                          Matching Targets ({evt.matches.length})
                          <InfoHint text="The corresponding items that match the Subject's criteria. For a new property, these are buyers whose budgets and preferred areas match. For a buyer update, these are properties that match their preferences." />
                        </h3>
                        <button
                          type="button"
                          onClick={() => toggleSelectAll(evt.id, allTargetIds)}
                          className="text-[11px] font-extrabold text-primary hover:underline cursor-pointer"
                        >
                          {isAllChecked ? "Deselect All" : "Select All"}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                        {evt.matches.map((match) => {
                          const checked = selectedIds.has(match.id);
                          return (
                            <div
                              key={match.id}
                              onClick={() => toggleTarget(evt.id, match.id)}
                              className={`rounded-lg border p-2.5 flex items-start gap-2.5 cursor-pointer transition-all hover:bg-slate-850/30 select-none ${
                                checked
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-slate-800 bg-slate-950/20"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {}} // toggled by div click
                                className="mt-0.5 rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex justify-between items-start gap-1">
                                  <h5 className="text-xs font-black text-white truncate">
                                    {match.name}
                                  </h5>
                                  <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                                    {match.score}%
                                  </span>
                                </div>
                                {match.detail && (
                                  <p className="text-[9px] text-slate-500 font-semibold">{match.detail}</p>
                                )}
                                {match.chips && match.chips.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {match.chips.slice(0, 2).map((chip) => (
                                      <span
                                        key={chip}
                                        className="text-[8px] font-bold border border-slate-800 bg-slate-900 px-1 py-0.2 rounded text-slate-400"
                                      >
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* One-time template setup — only shows when out-of-window
                        contacts couldn't be reached because new_property_alert
                        isn't approved yet. Once it is, sends are automatic. */}
                    {templateMissingTargets[evt.id] && templateMissingTargets[evt.id].length > 0 && (
                      <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3.5 space-y-2 animate-fade-in">
                        <p className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5 leading-tight">
                          <AlertTriangle className="size-4 shrink-0" />
                          <span>
                            {templateMissingTargets[evt.id].map((t) => t.name).join(", ")}{" "}
                            {templateMissingTargets[evt.id].length === 1 ? "is" : "are"} outside the
                            24-hour WhatsApp window. Alerts to them go out via the pre-approved{" "}
                            <code className="bg-slate-950 px-1 py-0.5 rounded">new_property_alert</code>{" "}
                            template —{" "}
                            {alertTemplateStatus === "PENDING"
                              ? "yours is waiting for Meta approval. Hit Send Match Alert again once it's approved."
                              : alertTemplateStatus === "REJECTED"
                                ? "yours was rejected by Meta. Resubmit it below."
                                : "a one-time setup you haven't done yet."}
                          </span>
                        </p>
                        {alertTemplateStatus !== "PENDING" && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => void handleSubmitAlertTemplate()}
                            disabled={submittingAlertTemplate}
                            className="text-[10px] h-7 border-amber-900 hover:bg-amber-950/40 text-amber-300 font-bold flex items-center gap-1 rounded-lg cursor-pointer"
                          >
                            {submittingAlertTemplate ? (
                              <RefreshCw className="size-3 animate-spin" />
                            ) : (
                              <Send className="size-3" />
                            )}
                            {alertTemplateStatus === "REJECTED"
                              ? "Resubmit template"
                              : "Create & submit template"}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Action Strip */}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        size="sm"
                        disabled={selectedIds.size === 0 || sendingId === evt.id}
                        onClick={() => handleSend(evt)}
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold text-xs h-9 px-4 rounded-xl cursor-pointer"
                      >
                        {sendingId === evt.id ? (
                          <>
                            <RefreshCw className="size-3.5 mr-1.5 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="size-3.5 mr-1.5" />
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
