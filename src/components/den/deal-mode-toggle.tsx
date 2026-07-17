"use client";

// ============================================================
// Deal Mode segmented control (Off / Soft / Aggressive) with a
// confirmation dialog on every change — activation explains the
// masked-matching consequences; deactivation warns that buyer
// interest stops.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DealMode = "off" | "soft" | "aggressive";

const OPTIONS: { value: DealMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Not for sale right now" },
  { value: "soft", label: "Soft", hint: "Quietly open to offers" },
  { value: "aggressive", label: "Aggressive", hint: "Actively selling — alert matching buyers" },
];

const CONFIRM_COPY: Record<DealMode, { title: string; body: string; cta: string }> = {
  soft: {
    title: "Turn on Deal Mode (Soft)?",
    body:
      "Your property becomes visible to matching buyers and agents — with your identity and exact address hidden until someone unlocks it. No alerts are pushed; interested buyers discover it in their match feed. You can turn this off any time.",
    cta: "Turn on Soft mode",
  },
  aggressive: {
    title: "Turn on Deal Mode (Aggressive)?",
    body:
      "Your property becomes visible to matching buyers and agents (identity and exact address hidden until unlocked), and matching buyers are notified immediately on WhatsApp. Expect faster interest. You can turn this off any time.",
    cta: "Turn on Aggressive mode",
  },
  off: {
    title: "Turn Deal Mode off?",
    body:
      "Your property leaves the matching pool and buyers will no longer discover it or place offers. Offers still awaiting your response will expire automatically after 48 hours. Any conversations already unlocked stay unlocked.",
    cta: "Turn off",
  },
};

export function DealModeToggle({
  propertyId,
  value,
  onChanged,
}: {
  propertyId: string;
  value: DealMode;
  onChanged?: (mode: DealMode) => void;
}) {
  const [current, setCurrent] = useState<DealMode>(value);
  const [pending, setPending] = useState<DealMode | null>(null);
  const [saving, setSaving] = useState(false);

  const applyChange = async () => {
    if (!pending) return;
    setSaving(true);
    const res = await fetch(`/api/den/properties/${propertyId}/deal-mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deal_mode: pending }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error || "Could not update Deal Mode");
      setPending(null);
      return;
    }
    setCurrent(pending);
    onChanged?.(pending);
    toast.success(
      pending === "off"
        ? "Deal Mode is off."
        : pending === "soft"
          ? "Deal Mode is on (Soft) — you're quietly open to offers."
          : "Deal Mode is on (Aggressive) — matching buyers will be alerted.",
    );
    setPending(null);
  };

  return (
    <div>
      <div className="flex rounded-xl border bg-muted/40 p-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.hint}
            onClick={() => {
              if (opt.value !== current) setPending(opt.value);
            }}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-xs font-bold transition-all ${
              current === opt.value
                ? opt.value === "off"
                  ? "bg-background shadow text-foreground"
                  : opt.value === "soft"
                    ? "bg-amber-500 text-white shadow"
                    : "bg-emerald-600 text-white shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
        {OPTIONS.find((o) => o.value === current)?.hint}
      </p>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>{CONFIRM_COPY[pending].title}</DialogTitle>
                <DialogDescription>{CONFIRM_COPY[pending].body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={applyChange} disabled={saving}>
                  {saving ? "Saving…" : CONFIRM_COPY[pending].cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
