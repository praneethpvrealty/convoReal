"use client";

// ============================================================
// Token Safe panel — shared by the owner deal room and the bidder's
// radar card. Optional, per-deal: secures the Indian-market token
// payment (bayana) after the owner meeting. Role decides which
// actions render; the server enforces them again.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Landmark, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface TokenEscrow {
  id: string;
  amount_minor: number;
  refund_conditions: string | null;
  provider: string;
  provider_ref: string | null;
  status: "proposed" | "accepted" | "funded" | "released" | "refunded" | "disputed" | "cancelled";
  proposed_by: "owner" | "bidder";
  owner_confirmed_at: string | null;
  bidder_confirmed_at: string | null;
}

const inr = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN")}`;

export function TokenSafePanel({
  role,
  endpoint,
  escrow,
  onChanged,
}: {
  role: "owner" | "bidder";
  /** POST target; receives { action, ... }. */
  endpoint: string;
  escrow: TokenEscrow | null;
  onChanged: (escrow: TokenEscrow | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [conditions, setConditions] = useState("");
  const [provider, setProvider] = useState<"manual_escrow" | "direct">("manual_escrow");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || "Could not update Token Safe");
        return;
      }
      onChanged((body?.escrow as TokenEscrow) ?? null);
    } finally {
      setBusy(false);
    }
  };

  const live = escrow && !["cancelled"].includes(escrow.status) ? escrow : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Landmark className="h-4 w-4 text-primary" />
        <p className="text-sm font-black">Token Safe</p>
        <span className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase text-muted-foreground">
          Optional
        </span>
      </div>

      {!live ? (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            Secure the token payment so neither side can back out silently — the amount and refund
            conditions are agreed upfront, and both parties confirm before it&apos;s treated as
            released. You can also just record a direct UPI/cheque token for the paper trail.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ts-amount" className="text-xs font-bold">Token amount (₹)</Label>
              <Input
                id="ts-amount"
                inputMode="numeric"
                placeholder="e.g. 200000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold">How</Label>
              <div className="flex rounded-lg border bg-muted/40 p-0.5">
                {(
                  [
                    { v: "manual_escrow", label: "Via escrow" },
                    { v: "direct", label: "Direct + receipt" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setProvider(opt.v)}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-bold transition-all ${
                      provider === opt.v ? "bg-background shadow" : "text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ts-conditions" className="text-xs font-bold">Refund conditions</Label>
            <Textarea
              id="ts-conditions"
              rows={2}
              placeholder="e.g. Fully refundable if the agreement to sell isn't signed within 30 days."
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy}
            className="text-xs font-bold"
            onClick={() => {
              const value = Number(amount.replace(/[,\s]/g, ""));
              if (!Number.isFinite(value) || value <= 0) {
                toast.error("Enter a valid token amount");
                return;
              }
              act("propose", {
                amount: value,
                refund_conditions: conditions.trim() || undefined,
                provider,
              });
            }}
          >
            {busy ? "Proposing…" : "Propose Token Safe"}
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
            <span>
              Token: <span className="font-black text-primary">{inr(live.amount_minor)}</span>
            </span>
            <span className="text-muted-foreground">
              {live.provider === "direct" ? "Direct payment + receipt" : "Via escrow service"}
            </span>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-black uppercase">
              {live.status}
            </span>
          </div>
          {live.refund_conditions && (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
              Refund terms: {live.refund_conditions}
            </p>
          )}

          {live.status === "proposed" &&
            (live.proposed_by === role ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  Waiting for the other party to accept…
                </p>
                <Button variant="outline" size="sm" disabled={busy} className="text-xs font-bold" onClick={() => act("cancel")}>
                  Withdraw proposal
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={busy} className="text-xs font-bold" onClick={() => act("decline")}>
                  Decline
                </Button>
                <Button size="sm" disabled={busy} className="text-xs font-bold" onClick={() => act("accept")}>
                  Accept terms
                </Button>
              </div>
            ))}

          {live.status === "accepted" &&
            (role === "bidder" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {live.provider === "direct"
                    ? "Pay the token directly (UPI/cheque), then record the reference here."
                    : "Fund the escrow with your provider, then record the escrow reference here."}
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Payment reference (escrow ID / UTR / cheque no.)"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    className="text-xs font-bold shrink-0"
                    onClick={() => act("mark-funded", { provider_ref: reference })}
                  >
                    Mark paid
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] font-semibold text-muted-foreground">
                Terms agreed — waiting for the buyer to pay the token.
              </p>
            ))}

          {live.status === "funded" && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground">
                Token paid{live.provider_ref ? ` (ref: ${live.provider_ref})` : ""}. When the
                agreement to sell is signed, both sides confirm and the token is treated as
                released to the owner.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold">
                  <ConfirmDot done={Boolean(live.owner_confirmed_at)} /> Owner ·{" "}
                  <ConfirmDot done={Boolean(live.bidder_confirmed_at)} /> Buyer
                </p>
                {!(role === "owner" ? live.owner_confirmed_at : live.bidder_confirmed_at) && (
                  <Button size="sm" disabled={busy} className="text-xs font-bold" onClick={() => act("confirm-release")}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    Confirm agreement signed
                  </Button>
                )}
              </div>
            </div>
          )}

          {live.status === "released" && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
              ✅ Token released — the property is blocked for this buyer. Best of luck with the
              registration!
            </p>
          )}
          {live.status === "refunded" && (
            <p className="text-xs font-semibold text-muted-foreground">
              Token refunded to the buyer per the agreed conditions.
            </p>
          )}
          {live.status === "disputed" && (
            <p className="text-xs font-semibold text-amber-600">
              This token is under dispute with the escrow provider — our support team will follow up.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ConfirmDot({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${done ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
    />
  );
}
