"use client";

/**
 * "Add to journey" picker — multi-select over the account's
 * properties (buyer mode) or contacts (seller mode). Rows already on
 * the journey are shown checked + locked so the user can see what's
 * covered without being able to double-add (the DB unique constraint
 * would reject it anyway). Candidates load lazily on first open.
 * Property rows expand inline (chevron) into a preview — photo, price,
 * type, config, area, facing, status — so the pick can be made without
 * opening the property elsewhere.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Home, Search, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatCurrencyShort } from "@/lib/currency-utils";
import { storagePublicUrl } from "@/lib/storage/url";
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
import { contactHandle } from "@/lib/contacts/reachability";

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
  property?: Property;
}

function PropertyPreview({
  property,
  currency,
}: {
  property: Property;
  currency: string;
}) {
  const image =
    property.images && property.images.length > 0
      ? storagePublicUrl(property.images[0])
      : null;
  const priceLabel =
    property.listing_type === "Rent" && property.rent_per_month
      ? `${formatCurrencyShort(property.rent_per_month, currency)}/mo`
      : property.price
        ? formatCurrencyShort(property.price, currency)
        : null;
  const area = property.area_sqft
    ? `${property.area_sqft} ${property.area_unit || "sqft"}`
    : null;
  const landArea = property.land_area
    ? `${property.land_area} ${property.land_area_unit || "sqft"}`
    : null;
  const locationLine = [
    property.location,
    ...[property.sublocality, property.city].filter(
      (part): part is string =>
        !!part &&
        !(property.location ?? "").toLowerCase().includes(part.toLowerCase()),
    ),
  ]
    .filter(Boolean)
    .join(", ");
  const facts = (
    [
      ["Price", priceLabel],
      ["Type", [property.type, property.listing_type].filter(Boolean).join(" · ")],
      [
        "Config",
        property.bedrooms
          ? `${property.bedrooms} BHK${
              property.bathrooms ? ` · ${property.bathrooms} bath` : ""
            }`
          : null,
      ],
      [
        "Area",
        [area, landArea && landArea !== area ? `${landArea} land` : null]
          .filter(Boolean)
          .join(" · "),
      ],
      ["Dimensions", property.dimensions],
      ["Facing", property.facing_direction],
      ["Status", property.status],
      ["Location", locationLine],
    ] as Array<[string, string | null | undefined]>
  ).filter((f): f is [string, string] => !!f[1]);

  return (
    <div className="flex gap-3 border-t border-slate-800/70 px-2.5 py-2.5">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={property.title}
          className="h-20 w-24 shrink-0 rounded-md border border-slate-800 object-cover"
        />
      )}
      <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1.5">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className={label === "Location" ? "col-span-2" : undefined}
          >
            <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
              {label}
            </dt>
            <dd
              className={cn(
                "text-[11px]",
                label === "Price"
                  ? "font-semibold text-emerald-300"
                  : "text-slate-200",
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    setSelected(new Set());
    setSearch("");
    setExpandedId(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (mode === "buyer") {
        const { data } = await supabase
          .from("properties")
          .select(
            "id, title, property_code, location, sublocality, city, price, rent_per_month, listing_type, status, type, bedrooms, bathrooms, area_sqft, area_unit, land_area, land_area_unit, dimensions, facing_direction, images",
          )
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
              property: p,
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
              title: c.name || contactHandle(c),
              subtitle: [contactHandle(c), c.classification, c.lead_temp]
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
              const expanded = expandedId === r.id;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "rounded-lg text-xs transition-colors",
                    isSel
                      ? "bg-primary/10"
                      : expanded
                        ? "bg-slate-800/50"
                        : "hover:bg-slate-800/70",
                  )}
                >
                  <div className="flex w-full items-center gap-1.5 px-2.5 py-2">
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => toggle(r.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 text-left",
                        already
                          ? "cursor-not-allowed opacity-40"
                          : isSel
                            ? "text-primary"
                            : "text-slate-200",
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
                          <span className="truncate font-semibold">
                            {r.title}
                          </span>
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
                    {r.property && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={expanded ? "Hide details" : "Show details"}
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-white"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </button>
                    )}
                  </div>
                  {expanded && r.property && (
                    <PropertyPreview
                      property={r.property}
                      currency={currency}
                    />
                  )}
                </div>
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
