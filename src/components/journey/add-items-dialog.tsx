"use client";

/**
 * "Add to journey" picker — multi-select over the account's
 * properties (buyer mode) or contacts (seller mode). Rows already on
 * the journey are shown checked + locked so the user can see what's
 * covered without being able to double-add (the DB unique constraint
 * would reject it anyway). Candidates load lazily on first open.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Home, Search, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatCurrencyShort } from "@/lib/currency-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Contact, Property } from "@/types";
import type { JourneyMode } from "./shared";

export interface AddItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: JourneyMode;
  accountId: string | null;
  /** property ids (buyer mode) / contact ids (seller mode) already on the journey */
  existingIds: Set<string>;
  currency: string;
  onAdd: (ids: string[]) => Promise<void>;
}

interface Row {
  id: string;
  title: string;
  subtitle: string;
  badge?: string | null;
}

export function AddItemsDialog({
  open,
  onOpenChange,
  mode,
  accountId,
  existingIds,
  currency,
  onAdd,
}: AddItemsDialogProps) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    setSelected(new Set());
    setSearch("");
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (mode === "buyer") {
        const { data } = await supabase
          .from("properties")
          .select("id, title, property_code, location, price, status")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!cancelled) {
          setRows(
            ((data ?? []) as Property[]).map((p) => ({
              id: p.id,
              title: p.title,
              subtitle: [
                p.location,
                p.price ? formatCurrencyShort(p.price, currency) : null,
                p.status,
              ]
                .filter(Boolean)
                .join(" · "),
              badge: p.property_code,
            })),
          );
        }
      } else {
        const { data } = await supabase
          .from("contacts")
          .select("id, name, name_tag, phone, classification, lead_temp")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!cancelled) {
          setRows(
            ((data ?? []) as Contact[]).map((c) => ({
              id: c.id,
              title: c.name || c.phone,
              subtitle: [c.phone, c.classification, c.lead_temp]
                .filter(Boolean)
                .join(" · "),
              badge: c.name_tag,
            })),
          );
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, mode, supabase, currency]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q) ||
        (r.badge ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const toggle = (id: string) => {
    if (existingIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await onAdd(Array.from(selected));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const Icon = mode === "buyer" ? Home : UserRound;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            {mode === "buyer" ? "Add properties to journey" : "Add contacts to journey"}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              mode === "buyer"
                ? "Search by title, code or locality…"
                : "Search by name or phone…"
            }
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-8 text-center text-xs text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              Nothing matches.
            </p>
          ) : (
            filtered.map((r) => {
              const already = existingIds.has(r.id);
              const isSel = selected.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={already}
                  onClick={() => toggle(r.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    already
                      ? "cursor-not-allowed opacity-40"
                      : isSel
                        ? "bg-primary/10 text-primary"
                        : "text-slate-200 hover:bg-slate-800/70",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      isSel || already
                        ? "border-primary bg-primary text-white"
                        : "border-slate-600 bg-slate-900",
                    )}
                  >
                    {(isSel || already) && <Check className="h-3 w-3" />}
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {r.badge && (
                        <span className="shrink-0 rounded border border-slate-800 bg-slate-950 px-1 py-px font-mono text-[9px] font-bold text-slate-400">
                          {r.badge}
                        </span>
                      )}
                      <span className="truncate font-semibold">{r.title}</span>
                      {already && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-500">
                          on journey
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {r.subtitle}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || saving}
            onClick={handleAdd}
          >
            {saving
              ? "Adding…"
              : `Add ${selected.size > 0 ? selected.size : ""} ${
                  mode === "buyer"
                    ? selected.size === 1
                      ? "property"
                      : "properties"
                    : selected.size === 1
                      ? "contact"
                      : "contacts"
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
