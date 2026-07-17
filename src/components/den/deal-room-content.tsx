"use client";

// Owners Den — deal room: the space that opens when an offer is
// accepted. Meeting scheduling + optional Token Safe.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { formatINR } from "./format";
import { TokenSafePanel, type TokenEscrow } from "./token-safe-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CalendarClock, Handshake, Phone } from "lucide-react";

interface DealRoomPayload {
  room: {
    id: string;
    agreed_amount: number;
    status: string;
    meeting_at: string | null;
  };
  property_title: string;
  bidder_agency: string;
  buyer_contact: { name: string | null; phone: string | null } | null;
  escrow: TokenEscrow | null;
}

export function DenDealRoomContent() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;

  const [data, setData] = useState<DealRoomPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [meetingAt, setMeetingAt] = useState("");
  const [savingMeeting, setSavingMeeting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/den/deal-rooms/${roomId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        setData(body);
        if (body?.room?.meeting_at) {
          setMeetingAt(new Date(body.room.meeting_at).toISOString().slice(0, 16));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return <p className="text-sm text-muted-foreground">Opening the deal room…</p>;
  if (!data?.room) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Handshake className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold">Deal room not found</p>
        <Link href="/den/bids" className="text-xs font-bold text-primary hover:underline">
          Back to offers
        </Link>
      </div>
    );
  }

  const saveMeeting = async () => {
    setSavingMeeting(true);
    try {
      const res = await fetch(`/api/den/deal-rooms/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "meeting",
          meeting_at: meetingAt ? new Date(meetingAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || "Could not save the meeting time");
        return;
      }
      toast.success(meetingAt ? "Meeting scheduled." : "Meeting cleared.");
    } finally {
      setSavingMeeting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link
          href="/den/bids"
          className="mb-1 flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Offers
        </Link>
        <h1 className="text-xl font-black tracking-tight">Deal room — {data.property_title}</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Agreed at <span className="font-black text-primary">{formatINR(data.room.agreed_amount)}</span> with{" "}
          {data.bidder_agency}
          {data.room.status === "token_secured" ? " · token secured ✅" : ""}
        </p>
      </div>

      {data.buyer_contact && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Buyer contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-sm font-bold">{data.buyer_contact.name || "On file with the agency"}</p>
            {data.buyer_contact.phone && (
              <a
                href={`https://wa.me/${data.buyer_contact.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                <Phone className="h-3 w-3" />
                {data.buyer_contact.phone} — chat on WhatsApp
              </a>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-primary" />
            Owner meeting
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs font-medium text-muted-foreground">
            Meet at the property or your agency&apos;s office before any money changes hands.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meeting-at" className="text-xs font-bold">Date &amp; time</Label>
              <Input
                id="meeting-at"
                type="datetime-local"
                value={meetingAt}
                onChange={(e) => setMeetingAt(e.target.value)}
                className="w-56"
              />
            </div>
            <Button size="sm" disabled={savingMeeting} onClick={saveMeeting} className="text-xs font-bold">
              {savingMeeting ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <TokenSafePanel
        role="owner"
        endpoint={`/api/den/deal-rooms/${roomId}`}
        escrow={data.escrow}
        onChanged={() => load()}
      />
    </div>
  );
}
