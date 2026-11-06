'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, RefreshCw } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/notifications?limit=30', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`notifications failed (${res.status})`);
        const json = (await res.json()) as {
          data: NotificationRow[];
          unreadCount: number;
        };
        if (cancelled) return;
        setItems(json.data || []);
        setUnread(json.unreadCount || 0);
        setLoadFailed(false);
      } catch (err) {
        console.error('[notifications] load failed:', err);
        if (!cancelled) setLoadFailed(true);
      }
    }

    load();

    function resync() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', resync);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', resync);
    };
  }, [user?.id, reloadToken]);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
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
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) =>
      prev.map((n) =>
        n.read_at ? n : { ...n, read_at: new Date().toISOString() }
      )
    );
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // Non-fatal; the next load reconciles the true state.
    }
  }, [unread]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) markAllRead();
    },
    [markAllRead]
  );

  const badge = unread > 9 ? '9+' : String(unread);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white focus:outline-none data-popup-open:bg-slate-800/70"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 p-0">
        <div className="border-foreground/10 flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loadFailed && items.length === 0 ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-2 px-3 py-8 text-center"
            >
              <p className="text-sm text-red-300">
                Couldn&apos;t load notifications.
              </p>
              <button
                type="button"
                onClick={() => setReloadToken((t) => t + 1)}
                className="text-primary hover:text-primary/80 flex items-center gap-1 text-xs font-medium"
              >
                <RefreshCw className="size-3" />
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              You&apos;re all caught up.
            </p>
          ) : (
            items.map((n) => {
              const body = (
                <div
                  className={`hover:bg-foreground/5 flex flex-col gap-0.5 px-3 py-2.5 transition-colors ${
                    n.read_at ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && (
                      <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {n.body && (
                        <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-line">
                          {n.body}
                        </p>
                      )}
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {formatDistanceToNowStrict(new Date(n.created_at), {
                          addSuffix: true,
                        })}
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
                  onClick={() => onOpenChange(false)}
                  className="border-foreground/5 block border-b last:border-b-0"
                >
                  {body}
                </Link>
              ) : (
                <div
                  key={n.id}
                  className="border-foreground/5 border-b last:border-b-0"
                >
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
