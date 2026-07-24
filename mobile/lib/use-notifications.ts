import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuthStore } from './auth-store';
import { queryClient } from './query';
import { supabase, uniqueChannel } from './supabase';

export interface NotificationRow {
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

/**
 * Mobile mirror of the web's notification bell data: the user's latest
 * in-app notifications plus a live unread count, refreshed by a
 * Realtime INSERT subscription. RLS scopes rows to auth.uid().
 */
export function useNotifications() {
  const userId = useAuthStore((s) => s.session?.user.id);

  const query = useQuery({
    queryKey: ['notifications', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, entity_type, entity_id, link, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    // Unique name: the bell and the notifications screen mount together.
    const channel = supabase
      .channel(uniqueChannel(`notifications:${userId}`))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const items = query.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return { items, unread, isLoading: query.isLoading };
}

/** Mark every unread notification read (fire-and-forget from the
 *  notifications screen; the next query reconciles). */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .eq('user_id', userId);
  queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
}
