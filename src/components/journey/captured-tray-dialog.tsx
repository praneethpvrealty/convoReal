"use client";

/**
 * Captured tray — the holding pen for journey items that exist but
 * are hidden from the canvas.
 *
 * WhatsApp shares are auto-captured every day, so they land here
 * (hidden) instead of hogging the mind map. The agent reviews the
 * queue and promotes the pairs worth tracking ("Show on map"),
 * clears the noise ("Remove"), or promotes everything at once.
 * Items hidden later from the detail sheet come back through this
 * same tray.
 */

import { formatDistanceToNow } from "date-fns";
import { Eye, Home, Trash2, UserRound } from "lucide-react";

import { formatCurrencyShort } from "@/lib/currency-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JourneyItem, JourneyItemSource } from "@/types";
import type { JourneyMode } from "./shared";

const SOURCE_LABELS: Record<JourneyItemSource, string> = {
  manual: "Added manually",
  whatsapp_share: "WhatsApp share",
  chat_import: "Chat import",
  inquiry_import: "Inquiry import",
};

export interface CapturedTrayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: JourneyMode;
  items: JourneyItem[];
  currency: string;
  canEdit: boolean;
  onShow: (item: JourneyItem) => void;
  onShowAll: () => void;
  onRemove: (item: JourneyItem) => void;
}

export function CapturedTrayDialog({
  open,
  onOpenChange,
  mode,
  items,
  currency,
  canEdit,
  onShow,
  onShowAll,
  onRemove,
}: CapturedTrayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            Captured — not on the map yet
          </DialogTitle>
        </DialogHeader>

        <p className="-mt-1 text-xs text-slate-400">
          {mode === "buyer"
            ? "Properties shared with this contact that were captured automatically. Show the ones worth tracking; remove the rest."
            : "Contacts this property was shared with, captured automatically. Show the ones worth tracking; remove the rest."}
        </p>

        <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              Nothing waiting — all captured shares have been reviewed.
            </p>
          ) : (
            items.map((item) => {
              const title =
                mode === "buyer"
                  ? item.property?.title ?? "Unknown property"
                  : item.contact?.name ?? item.contact?.phone ?? "Unknown contact";
              const subtitle =
                mode === "buyer"
                  ? [
                      item.property?.property_code,
                      item.property?.location,
                      item.property?.price
                        ? formatCurrencyShort(item.property.price, currency)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : [item.contact?.phone, item.contact?.classification]
                      .filter(Boolean)
                      .join(" · ");
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-800/80 bg-slate-900/50 px-2.5 py-2"
                >
                  {mode === "buyer" ? (
                    <Home className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  ) : (
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-200">
                        {title}
                      </span>
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                        {SOURCE_LABELS[item.source]}
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-slate-500">
                      {subtitle}
                      <span className="ml-1.5 text-slate-600">
                        {formatDistanceToNow(new Date(item.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onShow(item)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Show
                      </Button>
                      <button
                        type="button"
                        onClick={() => onRemove(item)}
                        aria-label="Remove from journey"
                        title="Remove from journey"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {canEdit && items.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              <Eye className="h-3.5 w-3.5" />
              Show all {items.length}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
