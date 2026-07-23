"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Eye, Loader2, MessageCircle, UserCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Viewer {
  contactId: string;
  name: string | null;
  phone: string | null;
  views: number;
  sessions: number;
  lastAt: string;
}

interface EventRow {
  contact_id: string;
  session_key: string | null;
  event_type: string;
  created_at: string;
  contacts:
    | { id: string; name: string | null; phone: string | null }[]
    | { id: string; name: string | null; phone: string | null }
    | null;
}

interface PropertyViewersDialogProps {
  propertyId: string | null;
  propertyTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Lists the identified viewers of a single property — the ones whose
// showcase views tied to a contact (a personalized ?v= tracked link, or a
// later self-identification). Anonymous / forwarded views carry no
// identity and can't appear here.
export function PropertyViewersDialog({
  propertyId,
  propertyTitle,
  open,
  onOpenChange,
}: PropertyViewersDialogProps) {
  const router = useRouter();
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !propertyId) return;
    let cancelled = false;
    setLoading(true);
    setViewers(null);

    async function load(pid: string) {
      try {
        const db = createClient();
        const { data, error } = await db
          .from("showcase_events")
          .select("contact_id, session_key, event_type, created_at, contacts(id, name, phone)")
          .eq("property_id", pid)
          .not("contact_id", "is", null)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (cancelled) return;

        const byContact = new Map<string, Viewer & { sessionKeys: Set<string> }>();
        for (const row of (data ?? []) as EventRow[]) {
          const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
          let v = byContact.get(row.contact_id);
          if (!v) {
            v = {
              contactId: row.contact_id,
              name: contact?.name ?? null,
              phone: contact?.phone ?? null,
              views: 0,
              sessions: 0,
              lastAt: row.created_at,
              sessionKeys: new Set<string>(),
            };
            byContact.set(row.contact_id, v);
          }
          if (row.event_type === "view_property") v.views += 1;
          if (row.session_key) v.sessionKeys.add(row.session_key);
          if (row.created_at > v.lastAt) v.lastAt = row.created_at;
        }

        const list = Array.from(byContact.values())
          .map(({ sessionKeys, ...v }) => ({ ...v, sessions: sessionKeys.size }))
          .sort((a, b) => (a.lastAt > b.lastAt ? -1 : a.lastAt < b.lastAt ? 1 : 0));
        setViewers(list);
      } catch (err) {
        console.error("[viewers] load failed:", err);
        toast.error("Failed to load viewers");
        if (!cancelled) setViewers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load(propertyId);
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  const openChat = useCallback(
    async (contactId: string) => {
      try {
        const db = createClient();
        const { data } = await db
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId)
          .order("updated_at", { ascending: false })
          .limit(1);
        const conversationId = (data as { id: string }[] | null)?.[0]?.id;
        router.push(conversationId ? `/inbox?c=${conversationId}` : `/contacts?q=${contactId}`);
      } catch (err) {
        console.error("[viewers] chat lookup failed:", err);
        toast.error("Failed to open conversation");
      }
    },
    [router]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 ring-slate-700 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <UserCheck className="size-4 text-primary" />
            Identified viewers
          </DialogTitle>
          <DialogDescription className="truncate text-slate-400">{propertyTitle}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : !viewers || viewers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 px-4 py-10 text-center">
            <UserCheck className="mx-auto mb-2 size-7 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">No identified viewers yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Views tie to a contact only when you share a personalized tracked link (Send personally)
              or the visitor submits an inquiry. Anonymous and forwarded views cannot be attributed.
            </p>
          </div>
        ) : (
          <>
            <div className="-mx-1 max-h-96 space-y-2 overflow-y-auto px-1">
              {viewers.map((v) => (
                <div
                  key={v.contactId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {v.name || v.phone || "Unknown"}
                    </p>
                    {v.name && v.phone && (
                      <p className="truncate text-[11px] text-slate-500">{v.phone}</p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      <Eye className="size-3 text-emerald-400" />
                      {v.views} view{v.views === 1 ? "" : "s"} ·{" "}
                      {formatDistanceToNowStrict(new Date(v.lastAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openChat(v.contactId)} className="shrink-0 gap-1.5">
                    <MessageCircle className="size-3.5" />
                    Message
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Only viewers who opened a tracked link or identified themselves appear here. Anonymous
              and forwarded views are not attributable.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
