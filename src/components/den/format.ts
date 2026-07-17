/** Compact Indian-market price display: ₹85 L, ₹1.2 Cr, ₹45,000. */
export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_00_00_000) {
    const cr = value / 1_00_00_000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2)} Cr`;
  }
  if (value >= 1_00_000) {
    const l = value / 1_00_000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)} L`;
  }
  return `₹${value.toLocaleString("en-IN")}`;
}

export const DEAL_MODE_META: Record<
  string,
  { label: string; badgeClass: string; blurb: string }
> = {
  off: {
    label: "Deal Mode Off",
    badgeClass: "bg-muted text-muted-foreground border",
    blurb: "Not open to offers",
  },
  soft: {
    label: "Soft",
    badgeClass: "bg-amber-500/15 text-amber-600 border border-amber-500/30",
    blurb: "Quietly open to offers",
  },
  aggressive: {
    label: "Aggressive",
    badgeClass: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30",
    blurb: "Actively selling",
  },
};
