"use client";

import { useState, useEffect, createElement } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
  Property,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrencyIcon } from "@/lib/currency-utils";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [brokerageType, setBrokerageType] = useState<"percentage" | "fixed">("percentage");
  const [brokerageValue, setBrokerageValue] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || "INR");
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
      setPropertyId(deal.property_id ?? "");
      setBrokerageType(deal.brokerage_type || "percentage");
      setBrokerageValue(deal.brokerage_value ? String(deal.brokerage_value) : "");
    } else {
      setTitle("");
      setValue("");
      if (accountId) {
        supabase
          .from('showcase_settings')
          .select('currency')
          .eq('account_id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.currency) {
              setCurrency(data.currency);
            } else {
              setCurrency("INR");
            }
          });
      } else {
        setCurrency("INR");
      }
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
      setPropertyId("");
      setBrokerageType("percentage");
      setBrokerageValue("");
    }
  }, [open, deal, defaultStageId, stages, accountId, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p, prop] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("properties").select("*").order("title"),
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
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error("Title, contact, and stage are required");
      return;
    }
    setSaving(true);

    const selectedStage = stages.find((s) => s.id === stageId);
    const isNegotiationOrLater = selectedStage && ["Negotiation/Token", "Due Diligence/Contract", "Closed Won"].includes(selectedStage.name);

    const dealValue = parseFloat(value) || 0;
    const brokValue = isNegotiationOrLater ? (parseFloat(brokerageValue) || 0) : null;
    const brokerageAmt = isNegotiationOrLater
      ? (brokerageType === "percentage" ? (dealValue * (brokValue || 0)) / 100 : (brokValue || 0))
      : null;

    let dealStatus: DealStatus = deal?.status || "open";
    if (selectedStage) {
      if (selectedStage.name.toLowerCase().includes("lost")) {
        dealStatus = "lost";
      } else if (selectedStage.name.toLowerCase().includes("won")) {
        dealStatus = "won";
      } else {
        dealStatus = "open";
      }
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
      property_id: propertyId || null,
      brokerage_type: isNegotiationOrLater ? brokerageType : null,
      brokerage_value: brokValue,
      brokerage_amount: brokerageAmt,
      status: dealStatus,
      // Server uses this to atomically sync property status
      stage_name: selectedStage?.name ?? null,
    };

    try {
      const url = deal ? `/api/deals/${deal.id}` : '/api/deals';
      const method = deal ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to save deal' }));
        toast.error(data.error || 'Failed to save deal');
        setSaving(false);
        return;
      }
    } catch {
      toast.error("Failed to save deal");
      setSaving(false);
      return;
    }

    setSaving(false);
    toast.success(deal ? "Deal updated" : "Deal created");
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);

    let targetStageId = deal.stage_id;
    if (status === "lost") {
      const lostStage = stages.find((s) => s.name.toLowerCase().includes("lost"));
      if (lostStage) {
        targetStageId = lostStage.id;
      }
    } else if (status === "won") {
      const wonStage = stages.find((s) => s.name.toLowerCase().includes("won"));
      if (wonStage) {
        targetStageId = wonStage.id;
      }
    }

    const activePropId = deal.property_id || propertyId;
    const targetStage = stages.find((s) => s.id === (targetStageId || stageId));

    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          target_stage_id: targetStageId,
          property_id: activePropId || null,
          current_stage_name: targetStage?.name ?? null,
        }),
      });

      setStatusAction(null);

      if (!res.ok) {
        toast.error("Failed to update deal status");
        return;
      }
    } catch {
      setStatusAction(null);
      toast.error("Failed to update deal status");
      return;
    }

    toast.success(
      status === "won" ? "Marked as won" : status === "lost" ? "Marked as lost" : "Deal reopened",
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
        toast.error("Failed to delete deal");
        return;
      }
    } catch {
      setDeleting(false);
      toast.error("Failed to delete deal");
      return;
    }

    toast.success("Deal deleted");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  function getEquivalentPriceLabel(priceStr: string, activeCurrency: string = "INR") {
    const priceNum = Number(priceStr);
    if (!priceStr || isNaN(priceNum) || priceNum <= 0) return '';
    
    if (activeCurrency === 'INR') {
      if (priceNum >= 10000000) {
        const cr = priceNum / 10000000;
        return `Equivalent to: ₹${cr.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1')} Crore`;
      }
      if (priceNum >= 100000) {
        const lakhs = priceNum / 100000;
        return `Equivalent to: ₹${lakhs.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1')} Lakhs`;
      }
      return `Equivalent to: ₹${priceNum.toLocaleString('en-IN')}`;
    }

    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'د.إ',
    };
    const sym = symbols[activeCurrency] || '';
    return `Equivalent to: ${sym}${priceNum.toLocaleString()}`;
  }

  function formatCalculatedBrokerage() {
    const val = parseFloat(value) || 0;
    const brokVal = parseFloat(brokerageValue) || 0;
    const amt = brokerageType === "percentage" ? (val * brokVal) / 100 : brokVal;
    
    if (currency === "INR") {
      if (amt >= 10000000) {
        const cr = amt / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Crore`;
      }
      if (amt >= 100000) {
        const lakhs = amt / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(amt);
    }
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
  const isNegotiationOrLater = selectedStage && ["Negotiation/Token", "Due Diligence/Contract", "Closed Won"].includes(selectedStage.name);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-slate-700/50 p-4">
            <SheetTitle className="text-white">
              {deal ? "Edit Deal" : "New Deal"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-slate-300">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Deal title"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-300">Contact</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
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
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
                    className: "absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                  })}
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-slate-700 bg-slate-800 pl-7 text-white"
                  />
                </div>
                {value && !isNaN(Number(value)) && Number(value) > 0 && (
                  <p className="text-[11px] text-primary font-semibold mt-1">
                    {getEquivalentPriceLabel(value, currency)}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Currency</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary"
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

            <div className="grid gap-2">
              <Label className="text-slate-300">Stage</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {isNegotiationOrLater && (
              <div className="grid grid-cols-2 gap-3 border border-slate-800 rounded-lg p-3 bg-slate-950/40">
                <div className="grid gap-2">
                  <Label className="text-slate-300">Brokerage Type</Label>
                  <select
                    value={brokerageType}
                    onChange={(e) => setBrokerageType(e.target.value as "percentage" | "fixed")}
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary font-medium"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Value</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-300 font-medium">
                    {brokerageType === "percentage" ? "Brokerage (%)" : "Brokerage Amount"}
                  </Label>
                  <Input
                    type="number"
                    value={brokerageValue}
                    onChange={(e) => setBrokerageValue(e.target.value)}
                    placeholder={brokerageType === "percentage" ? "2" : "0"}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                </div>
                {brokerageValue && !isNaN(Number(brokerageValue)) && Number(brokerageValue) > 0 && (
                  <div className="col-span-2 mt-1">
                    <p className="text-[11px] text-primary font-semibold">
                      Calculated Brokerage: {formatCalculatedBrokerage()}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-slate-300">Assigned To</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary"
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
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Status
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
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
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Mark as Lost
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
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
                onClick={() => onOpenChange(false)}
                className="flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Saving..." : deal ? "Save Changes" : "Create Deal"}
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
                      {deleting ? "Deleting..." : "Confirm"}
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
      </SheetContent>
    </Sheet>
  );
}
