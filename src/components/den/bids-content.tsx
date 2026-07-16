"use client";

// Owners Den — offers inbox: accept / reject / counter, with the
// bidder masked as a professional card until acceptance.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { formatINR } from "./format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, HandCoins, Phone, ShieldCheck } from "lucide-react";

interface DenBid {
  id: string;
  property_id: string;
  property_title: string;
  property_image: string | null;
  amount: number;
  bid_type: "sale" | "rent";
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "countered" | "withdrawn" | "expired";
  counter_amount: number | null;
  counter_message: string | null;
  expires_at: string | null;
  created_at: string;
  bidder_agency: string;
  bidder_contact: { name: string | null; phone: string | null } | null;
}

const STATUS_META: Record<DenBid["status"], { label: string; className: string }> = {
  pending: { label: "Awaiting your response", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  countered: { label: "You countered", className: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  accepted: { label: "Accepted", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-muted text-muted-foreground" },
  withdrawn: { label: "Withdrawn by buyer", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
};

export function DenBidsContent() {
  const [bids, setBids] = useState<DenBid[] | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<DenBid | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterMessage, setCounterMessage] = useState("");

  const load = useCallback(() => {
    fetch("/api/den/bids")
      .then((res) => (res.ok ? res.json() : { bids: [] }))
      .then((body) => setBids(body.bids || []))
      .catch(() => setBids([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (bid: DenBid, action: "accept" | "reject" | "counter", extra?: { amount: number; message?: string }) => {
    setActingId(bid.id);
    try {
      const res = await fetch(`/api/den/bids/${bid.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || "Could not update the offer");
        return;
      }
      if (action === "accept") {
        toast.success("Offer accepted! Contact details are now shared both ways.");
      } else if (action === "reject") {
        toast.success("Offer rejected.");
      } else {
        toast.success("Counter-offer sent.");
      }
      setCounterFor(null);
      load();
    } finally {
      setActingId(null);
    }
  };

  const live = (bids || []).filter((b) => b.status === "pending" || b.status === "countered");
  const resolved = (bids || []).filter((b) => !["pending", "countered"].includes(b.status));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-black tracking-tight">Offers</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Bids from verified buyers and agencies on your Deal Mode properties. Their contact
          details are shared only when you accept.
        </p>
      </div>

      {bids === null ? (
        <p className="text-sm text-muted-foreground">Loading your offers…</p>
      ) : bids.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <HandCoins className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">No offers yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Turn on Deal Mode for a property and matching buyers can discover it and place
              offers — you&apos;ll see them here and on WhatsApp.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {live.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-black tracking-tight">Needs your response ({live.length})</h2>
              {live.map((bid) => (
                <BidCard key={bid.id} bid={bid} actingId={actingId} onAct={act} onCounter={(b) => {
                  setCounterFor(b);
                  setCounterAmount("");
                  setCounterMessage("");
                }} />
              ))}
            </div>
          )}
          {resolved.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-black tracking-tight text-muted-foreground">History</h2>
              {resolved.map((bid) => (
                <BidCard key={bid.id} bid={bid} actingId={actingId} onAct={act} onCounter={() => {}} />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={counterFor !== null} onOpenChange={(open) => !open && setCounterFor(null)}>
        <DialogContent>
          {counterFor && (
            <>
              <DialogHeader>
                <DialogTitle>Counter this offer</DialogTitle>
                <DialogDescription>
                  {counterFor.bidder_agency} offered {formatINR(counterFor.amount)}
                  {counterFor.bid_type === "rent" ? " per month" : ""} on {counterFor.property_title}.
                  Name your figure — they can accept it or walk away.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="counter-amount" className="text-xs font-bold">Your counter (₹)</Label>
                  <Input
                    id="counter-amount"
                    inputMode="numeric"
                    placeholder="e.g. 13500000"
                    value={counterAmount}
                    onChange={(e) => setCounterAmount(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="counter-message" className="text-xs font-bold">Message (optional)</Label>
                  <Textarea
                    id="counter-message"
                    rows={2}
                    placeholder="e.g. Includes the covered parking. Registration extra."
                    value={counterMessage}
                    onChange={(e) => setCounterMessage(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCounterFor(null)}>Cancel</Button>
                <Button
                  disabled={actingId === counterFor.id}
                  onClick={() => {
                    const amount = Number(counterAmount.replace(/[,\s]/g, ""));
                    if (!Number.isFinite(amount) || amount <= 0) {
                      toast.error("Enter a valid counter amount");
                      return;
                    }
                    act(counterFor, "counter", { amount, message: counterMessage.trim() || undefined });
                  }}
                >
                  {actingId === counterFor.id ? "Sending…" : "Send counter-offer"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BidCard({
  bid,
  actingId,
  onAct,
  onCounter,
}: {
  bid: DenBid;
  actingId: string | null;
  onAct: (bid: DenBid, action: "accept" | "reject") => void;
  onCounter: (bid: DenBid) => void;
}) {
  const meta = STATUS_META[bid.status];
  const isLive = bid.status === "pending" || bid.status === "countered";
  const acting = actingId === bid.id;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
            {bid.property_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bid.property_image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{bid.property_title}</p>
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-primary" />
              {bid.bidder_agency}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-base font-black text-primary">
              {formatINR(bid.amount)}
              {bid.bid_type === "rent" ? " /mo" : ""}
            </p>
            <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-black ${meta.className}`}>
              {meta.label}
            </span>
          </div>
        </div>

        {bid.message && (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            “{bid.message}”
          </p>
        )}
        {bid.status === "countered" && bid.counter_amount && (
          <p className="text-xs font-semibold text-sky-600">
            Your counter: {formatINR(bid.counter_amount)} — waiting for the buyer.
          </p>
        )}
        {bid.status === "accepted" && bid.bidder_contact && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <p className="text-xs font-black text-emerald-700 dark:text-emerald-400">
              Buyer contact: {bid.bidder_contact.name || "On file"}
            </p>
            {bid.bidder_contact.phone && (
              <a
                href={`https://wa.me/${bid.bidder_contact.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-bold text-emerald-600 hover:underline"
              >
                <Phone className="h-3 w-3" />
                {bid.bidder_contact.phone}
              </a>
            )}
          </div>
        )}

        {isLive && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => onAct(bid, "reject")}
              className="text-xs font-bold"
            >
              Reject
            </Button>
            {bid.status === "pending" && (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() => onCounter(bid)}
                className="text-xs font-bold"
              >
                Counter
              </Button>
            )}
            <Button
              size="sm"
              disabled={acting}
              onClick={() => onAct(bid, "accept")}
              className="text-xs font-bold"
            >
              {acting ? "Working…" : "Accept offer"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
