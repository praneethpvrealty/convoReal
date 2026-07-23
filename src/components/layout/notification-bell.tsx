"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  // Initial load + live updates on one realtime channel, mirroring the
  // inbox unread-count hook. A new row for this user lands in the feed
  // instantly; a tab-focus resync catches anything missed while hidden.
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as { data: NotificationRow[]; unreadCount: number };
        if (cancelled) return;
        setItems(json.data || []);
        setUnread(json.unreadCount || 0);
      } catch {
        // Best-effort — the bell simply stays empty on failure.
      }
    }

    load();

    function resync() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", resync);

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          setItems((prev) => [row, ...prev].slice(0, 30));
          setUnread((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      // Non-fatal; the next load reconciles the true state.
    }
  }, [unread]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) markAllRead();
    },
    [markAllRead]
  );

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white focus:outline-none data-popup-open:bg-slate-800/70"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 gap-0 p-0"
      >
        <div className="flex items-center justify-between border-b border-foreground/10 px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            items.map((n) => {
              const body = (
                <div
                  className={`flex flex-col gap-0.5 px-3 py-2.5 transition-colors hover:bg-foreground/5 ${
                    n.read_at ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {n.body && (
                        <p className="whitespace-pre-line text-xs text-muted-foreground line-clamp-3">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </div>
              );
              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="block border-b border-foreground/5 last:border-b-0"
                >
                  {body}
                </Link>
              ) : (
                <div key={n.id} className="border-b border-foreground/5 last:border-b-0">
                  {body}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
