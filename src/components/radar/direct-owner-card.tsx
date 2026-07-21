"use client";

// ============================================================
// Match Radar — "Direct Owner" card (Owners Den, source='deal_mode').
//
// The subject property belongs to ANOTHER tenant: everything shown
// pre-unlock comes from the event's masked subject_snapshot. Unlock
// burns credits from this account's wallet (/api/match-unlocks) and
// reveals the full listing + the owner's contact.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building,
  Lock,
  MapPin,
  Phone,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { matchUnlockCost } from "@/lib/den/costs";
import { storagePublicUrl } from "@/lib/storage/url";
import { TokenSafePanel, type TokenEscrow } from "@/components/den/token-safe-panel";
import type { MatchEvent } from "@/types";

interface UnlockedPayload {
  property: Record<string, unknown>;
  owner: { name: string | null; phone: string | null } | null;
  managing_agency: string | null;
}

interface MyBid {
  id: string;
  amount: number;
  status: "pending" | "accepted" | "rejected" | "countered" | "withdrawn" | "expired";
  counter_amount: number | null;
  counter_message: string | null;
}

/** Place / track this account's offer on an unlocked property. */
function BidWidget({
  propertyId,
  listingType,
  minBid,
}: {
  propertyId: string;
  listingType: string;
  minBid: number | null;
}) {
  const [bid, setBid] = useState<MyBid | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bids?property_id=${propertyId}`)
      .then((res) => (res.ok ? res.json() : { bids: [] }))
      .then((body) => {
        if (cancelled) return;
        const live = (body.bids || []).find((b: MyBid) =>
          ["pending", "countered", "accepted"].includes(b.status),
        );
        setBid(live || null);
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const place = async () => {
    const value = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid offer amount");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, amount: value, message: message.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || "Could not place the offer");
        return;
      }
      setBid(body.bid as MyBid);
      toast.success("Offer sent to the owner!");
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: "withdraw" | "accept-counter") => {
    if (!bid) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bids/${bid.id}/${path}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || "Could not update the offer");
        return;
      }
      setBid(path === "withdraw" ? null : (body.bid as MyBid));
      toast.success(path === "withdraw" ? "Offer withdrawn." : "Deal agreed at the counter price!");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  if (bid) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <p className="text-xs font-black text-slate-200">
          Your offer: {formatValue(bid.amount)}
          {listingType === "Rent" ? " /mo" : ""}
          <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase">{bid.status}</span>
        </p>
        {bid.status === "countered" && bid.counter_amount && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-sky-400">
              Owner countered at {formatValue(bid.counter_amount)}
              {bid.counter_message ? ` — “${bid.counter_message}”` : ""}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act("accept-counter")}
                className="h-7 flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg cursor-pointer"
              >
                Accept counter
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => act("withdraw")}
                className="h-7 text-[11px] font-bold rounded-lg cursor-pointer"
              >
                Walk away
              </Button>
            </div>
          </div>
        )}
        {bid.status === "pending" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => act("withdraw")}
            className="h-7 text-[11px] font-bold rounded-lg cursor-pointer"
          >
            Withdraw offer
          </Button>
        )}
        {bid.status === "accepted" && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-emerald-400">
              🎉 Accepted — take it forward with the owner directly.
            </p>
            <BidderDealRoom bidId={bid.id} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
      <p className="text-xs font-black text-slate-200">Place an offer (free)</p>
      {minBid ? (
        <p className="text-[10px] font-semibold text-slate-500">
          Owner considers offers from {formatValue(minBid)}.
        </p>
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        placeholder={listingType === "Rent" ? "Monthly rent you're offering (₹)" : "Your offer (₹)"}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full h-8 rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-primary"
      />
      <input
        type="text"
        placeholder="Message to the owner (optional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full h-8 rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-primary"
      />
      <Button
        size="sm"
        disabled={busy}
        onClick={place}
        className="w-full h-8 text-[11px] font-bold rounded-lg cursor-pointer"
      >
        {busy ? "Sending…" : "Send offer to owner"}
      </Button>
    </div>
  );
}

/** Bidder side of the deal room (opens on acceptance): Token Safe. */
function BidderDealRoom({ bidId }: { bidId: string }) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<TokenEscrow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deal-rooms?bid_id=${bidId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body?.room?.id) {
          setRoomId(body.room.id as string);
          setEscrow((body.escrow as TokenEscrow) ?? null);
        }
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [bidId]);

  if (!loaded || !roomId) return null;
  return (
    <TokenSafePanel
      role="bidder"
      endpoint={`/api/deal-rooms/${roomId}/token-safe`}
      escrow={escrow}
      onChanged={(next) => setEscrow(next)}
    />
  );
}

function formatValue(v: unknown): string {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return "Not specified";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2).replace(/\.00$/, "")} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function DirectOwnerCard({
  event,
  onDismiss,
  dismissing,
}: {
  event: MatchEvent;
  onDismiss: (eventId: string) => void;
  dismissing: boolean;
}) {
  const snapshot = event.subject_snapshot;
  const bestScore = event.matches.reduce((max, m) => Math.max(max, m.score), 0);
  const cost = matchUnlockCost(bestScore);

  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState<UnlockedPayload | null>(null);

  // Someone in this account may have unlocked it already.
  useEffect(() => {
    if (!event.property_id) return;
    let cancelled = false;
    fetch(`/api/match-unlocks?property_id=${event.property_id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.unlocked && body.property) {
          setUnlocked(body as UnlockedPayload);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [event.property_id]);

  const handleUnlock = async () => {
    if (!event.property_id) return;
    setUnlocking(true);
    try {
      const res = await fetch("/api/match-unlocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: event.property_id, match_event_id: event.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.code === "insufficient_credits") {
          toast.error(body.error || "Not enough credits — top up in Settings → Billing.");
        } else {
          toast.error(body?.error || "Could not unlock this property");
        }
        return;
      }
      setUnlocked(body as UnlockedPayload);
      toast.success(
        body.already
          ? "Already unlocked by your team — no credits charged."
          : `Unlocked! ${body.credits_burned} credits used.`,
      );
    } finally {
      setUnlocking(false);
    }
  };

  if (!snapshot) return null;

  const what = snapshot.bedrooms ? `${snapshot.bedrooms} BHK ${snapshot.type}` : snapshot.type;
  const band = snapshot.rent_band ? `${snapshot.rent_band} /mo` : snapshot.price_band;
  const property = unlocked?.property;

  return (
    <div className="rounded-xl border border-amber-700/40 bg-slate-900 overflow-hidden flex flex-col">
      {/* Header strip */}
      <div className="bg-gradient-to-r from-amber-950/40 to-slate-950/45 px-5 py-3 border-b border-slate-850 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-400 border-amber-500/20">
            <Sparkles className="size-3" />
            Direct Owner {snapshot.deal_mode === "aggressive" ? "· Actively Selling" : ""}
          </span>
          <span className="text-[10px] font-bold text-slate-500">
            {new Date(event.created_at).toLocaleDateString()}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(event.id)}
          disabled={dismissing}
          className="text-[11px] font-bold text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-lg h-7 px-2 cursor-pointer"
        >
          <Trash2 className="size-3 mr-1" />
          Dismiss
        </Button>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Subject: masked or unlocked property */}
        <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-800 pb-4 md:pb-0 md:pr-5 space-y-3">
          {!property ? (
            <>
              <div className="flex items-start gap-2">
                <Building className="size-4.5 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-white leading-tight">{what}</h4>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-1">
                    <MapPin className="size-3" />
                    {snapshot.locality || snapshot.city || "Location hidden"}
                  </p>
                </div>
                <span className="ml-auto shrink-0 text-sm font-black text-emerald-400">
                  {bestScore}%
                </span>
              </div>
              <div className="bg-slate-950/20 rounded-lg p-2.5 space-y-1 text-xs border border-slate-850">
                <p className="text-slate-300 font-semibold">
                  {snapshot.rent_band ? "Rent: " : "Price: "}
                  <span className="text-slate-200">{band || "On request"}</span>
                </p>
                <p className="text-slate-400 text-[10px]">
                  {snapshot.area_sqft ? `${snapshot.area_sqft} ${snapshot.area_unit || "Sq.Ft."} · ` : ""}
                  For {snapshot.listing_type}
                </p>
              </div>
              {/* Blurred owner block */}
              <div className="relative rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="blur-[6px] select-none space-y-1" aria-hidden>
                  <p className="text-xs font-bold text-slate-300">Owner: Rakesh Kumar</p>
                  <p className="text-xs text-slate-400">+91 98••• ••••3</p>
                  <p className="text-xs text-slate-400">12/4, 4th Cross, ████████</p>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="flex items-center gap-1.5 rounded-full bg-slate-950/90 border border-amber-700/40 px-3 py-1.5 text-[10px] font-black text-amber-300">
                    <Lock className="size-3" />
                    Owner details locked
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleUnlock}
                disabled={unlocking}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs h-9 rounded-xl cursor-pointer"
              >
                <Unlock className="size-3.5 mr-1.5" />
                {unlocking ? "Unlocking…" : `Unlock owner details — ${cost} credits`}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <Building className="size-4.5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-white leading-tight">
                    {String(property.title || what)}
                  </h4>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-1">
                    <MapPin className="size-3" />
                    {String(property.location || "")}
                  </p>
                </div>
              </div>
              {Array.isArray(property.images) && (property.images as string[]).length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto">
                  {(property.images as string[]).slice(0, 4).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={storagePublicUrl(url)} alt="" className="h-16 w-24 shrink-0 rounded-md object-cover" />
                  ))}
                </div>
              )}
              <div className="bg-slate-950/20 rounded-lg p-2.5 space-y-1 text-xs border border-slate-850">
                <p className="text-slate-300 font-semibold">
                  {property.listing_type === "Rent"
                    ? `Rent: ${formatValue(property.rent_per_month)} /mo`
                    : `Price: ${formatValue(property.price)}`}
                </p>
                {typeof property.property_code === "string" && property.property_code && (
                  <p className="text-slate-400 text-[10px]">Code: {property.property_code}</p>
                )}
              </div>
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 space-y-1">
                <p className="text-xs font-black text-emerald-300">
                  Owner: {unlocked?.owner?.name || "On file"}
                </p>
                {unlocked?.owner?.phone && (
                  <a
                    href={`https://wa.me/${unlocked.owner.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:underline"
                  >
                    <Phone className="size-3" />
                    {unlocked.owner.phone} — chat on WhatsApp
                  </a>
                )}
                {unlocked?.managing_agency && (
                  <p className="text-[10px] text-slate-400">
                    Listed via {unlocked.managing_agency}
                  </p>
                )}
              </div>
              {event.property_id && (
                <BidWidget
                  propertyId={event.property_id}
                  listingType={String(property.listing_type || "Sale")}
                  minBid={Number(property.min_bid) || null}
                />
              )}
            </>
          )}
        </div>

        {/* Matched buyers from THIS account */}
        <div className="md:col-span-7 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Your matching {event.matches.length === 1 ? "buyer" : "buyers"} ({event.matches.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
            {event.matches.map((match) => (
              <div
                key={match.id}
                className="rounded-lg border border-slate-800 bg-slate-950/20 p-2.5"
              >
                <div className="flex justify-between items-start gap-1">
                  <h5 className="text-xs font-black text-white truncate">{match.name}</h5>
                  <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                    {match.score}%
                  </span>
                </div>
                {match.detail && (
                  <p className="text-[9px] text-slate-500 font-semibold">{match.detail}</p>
                )}
                {match.chips && match.chips.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {match.chips.slice(0, 3).map((chip) => (
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
            ))}
          </div>
          {!property && (
            <p className="text-[11px] text-slate-500 font-medium">
              This property was listed directly by its owner{snapshot.locality ? ` in ${snapshot.locality}` : ""}.
              Unlock to see the full listing and contact the owner for your{" "}
              {event.matches.length === 1 ? "buyer" : "buyers"}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
