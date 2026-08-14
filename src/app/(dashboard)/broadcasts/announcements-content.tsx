'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mic, Plus, Send, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  NARRATION_LANGUAGES,
  type NarrationLanguage,
} from '@/lib/video/listing-video';
import type { AnnouncementSendCounts } from '@/lib/voice/announcements';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableContactMultiSelect } from '@/components/ui/searchable-contact-multi-select';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { InfoHint } from '@/components/ui/info-hint';

const TEXT_MAX = 1200;

interface Announcement {
  id: string;
  title: string;
  body_text: string;
  language: string;
  status: 'generating' | 'ready' | 'failed';
  audio_url: string | null;
  error: string | null;
  sent_counts: Partial<AnnouncementSendCounts>;
  last_sent_at: string | null;
  created_at: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

const STATUS_STYLES: Record<Announcement['status'], string> = {
  generating: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  ready: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

function languageLabel(code: string): string {
  return NARRATION_LANGUAGES[code as NarrationLanguage] ?? code;
}

function countsSummary(counts: Partial<AnnouncementSendCounts>): string | null {
  const parts: string[] = [];
  if (counts.audio) parts.push(`${counts.audio} voice`);
  if (counts.text) parts.push(`${counts.text} text`);
  if (counts.skipped_window)
    parts.push(`${counts.skipped_window} outside window`);
  if (counts.skipped_voice_pref)
    parts.push(`${counts.skipped_voice_pref} prefer calls`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function AnnouncementsContent() {
  const canManage = useCan('send-messages');
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<Announcement | null>(null);

  const announcementsQuery = useQuery({
    queryKey: ['voice-announcements'],
    queryFn: () => api<Announcement[]>('/api/announcements'),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === 'generating') ? 5000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-announcements'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const announcements = announcementsQuery.data ?? [];

  if (announcementsQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Plain announcements rendered to WhatsApp voice notes in your
          customers&apos; language, delivered by each contact&apos;s channel
          preference.
          <InfoHint
            text={`The text is translated and narrated on the worker (costs ${AI_FEATURE_COSTS.audio_announcement} cr per render, refunded if it fails). Sends go only to contacts inside the 24-hour window; a contact's stated channel preference beats the send's default, and contacts preferring calls are skipped.`}
          />
        </p>
        <GatedButton
          canAct={canManage}
          gateReason="create announcements"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Announcement
        </GatedButton>
      </div>

      {announcements.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <Mic className="h-8 w-8 text-slate-600" />
          <p className="text-sm font-medium text-slate-300">
            No announcements yet
          </p>
          <p className="max-w-md text-xs text-slate-500">
            Write the announcement once — it becomes a voice note in the
            language you pick, ready to send to any set of contacts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">
                      {a.title}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize',
                        STATUS_STYLES[a.status]
                      )}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                    {a.body_text}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {languageLabel(a.language)}
                    {countsSummary(a.sent_counts)
                      ? ` · ${countsSummary(a.sent_counts)}`
                      : ''}
                    {a.status === 'failed' && a.error ? ` · ${a.error}` : ''}
                  </p>
                  {a.status === 'ready' && a.audio_url && (
                    <audio
                      controls
                      preload="none"
                      src={a.audio_url}
                      className="mt-2 h-9 w-full max-w-md"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {a.status === 'ready' && (
                    <GatedButton
                      canAct={canManage}
                      gateReason="send announcements"
                      size="sm"
                      onClick={() => setSendTarget(a)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send
                    </GatedButton>
                  )}
                  <GatedButton
                    canAct={canManage}
                    gateReason="delete announcements"
                    size="sm"
                    variant="ghost"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete announcement "${a.title}"?`)) {
                        deleteMutation.mutate(a.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                  </GatedButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateAnnouncementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <SendAnnouncementDialog
        announcement={sendTarget}
        onClose={() => setSendTarget(null)}
      />
    </div>
  );
}

function CreateAnnouncementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<NarrationLanguage>('en-IN');

  const createMutation = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, text, language }),
      }),
    onSuccess: () => {
      toast.success(
        'Voice note is being generated — it appears here when ready.'
      );
      queryClient.invalidateQueries({ queryKey: ['voice-announcements'] });
      onOpenChange(false);
      setTitle('');
      setText('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New audio announcement</DialogTitle>
          <DialogDescription>
            Write it in English — it is translated and narrated in the language
            you pick. Costs {AI_FEATURE_COSTS.audio_announcement} cr per render;
            failed renders are refunded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="an-title">Title</Label>
            <Input
              id="an-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Diwali open-house weekend"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="an-text">Announcement text</Label>
            <Textarea
              id="an-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
              rows={5}
              placeholder="Namaste! This weekend we are hosting an open house at…"
            />
            <p className="text-right text-xs text-slate-500">
              {text.length}/{TEXT_MAX}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="an-language">Narration language</Label>
            <select
              id="an-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as NarrationLanguage)}
              className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
            >
              {Object.entries(NARRATION_LANGUAGES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !text.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Generate voice note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendAnnouncementDialog({
  announcement,
  onClose,
}: {
  announcement: Announcement | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [defaultChannel, setDefaultChannel] = useState<
    'whatsapp_audio' | 'whatsapp_text'
  >('whatsapp_audio');

  const contactsQuery = useQuery({
    queryKey: ['voice-announcements', 'contacts', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone, name_tag')
        .eq('is_merged', false)
        .not('phone', 'is', null)
        .order('created_at', { ascending: false })
        .limit(2000);
      return data ?? [];
    },
    enabled: Boolean(announcement) && Boolean(accountId),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api<{ run: AnnouncementSendCounts }>(
        `/api/announcements/${announcement!.id}/send`,
        {
          method: 'POST',
          body: JSON.stringify({
            contact_ids: contactIds,
            default_channel: defaultChannel,
          }),
        }
      ),
    onSuccess: (result) => {
      const summary = countsSummary(result.run) ?? 'nothing sent';
      toast.success(`Announcement sent — ${summary}`);
      queryClient.invalidateQueries({ queryKey: ['voice-announcements'] });
      setContactIds([]);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSend = useMemo(
    () => contactIds.length > 0 && contactIds.length <= 100,
    [contactIds]
  );

  return (
    <Dialog
      open={Boolean(announcement)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send “{announcement?.title}”</DialogTitle>
          <DialogDescription>
            Goes only to contacts inside the 24-hour window (up to 100 per
            send). A contact&apos;s own channel preference beats the default
            below; contacts preferring calls are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Recipients</Label>
            <SearchableContactMultiSelect
              contacts={contactsQuery.data ?? []}
              value={contactIds}
              onChange={setContactIds}
              placeholder="Choose contacts…"
            />
            {contactIds.length > 100 && (
              <p className="text-xs text-rose-400">
                At most 100 recipients per send — split larger audiences.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Default delivery (when a contact has no preference)</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={
                  defaultChannel === 'whatsapp_audio' ? 'default' : 'outline'
                }
                onClick={() => setDefaultChannel('whatsapp_audio')}
              >
                🎙️ Voice note
              </Button>
              <Button
                type="button"
                size="sm"
                variant={
                  defaultChannel === 'whatsapp_text' ? 'default' : 'outline'
                }
                onClick={() => setDefaultChannel('whatsapp_text')}
              >
                💬 Text
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSend || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
          >
            <Send className="h-4 w-4" />
            Send announcement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
