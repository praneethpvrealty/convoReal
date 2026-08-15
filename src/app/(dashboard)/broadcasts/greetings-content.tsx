'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ExternalLink,
  PartyPopper,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  GREETING_MESSAGE_MAX,
  GREETING_TONES,
  type GreetingTone,
} from '@/lib/greetings/generate';
import {
  OCCASIONS,
  daysUntil,
  upcomingOccasions,
} from '@/lib/greetings/occasions';
import type { OccasionGreeting } from '@/lib/greetings/types';
import { storagePublicUrl } from '@/lib/storage/url';
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
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { InfoHint } from '@/components/ui/info-hint';

const CUSTOM_OCCASION = 'custom';

interface TemplateState {
  status: string | null;
  category: string | null;
  rejectionReason: string | null;
}

interface TagRow {
  id: string;
  name: string;
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

const STATUS_STYLES: Record<OccasionGreeting['status'], string> = {
  draft: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  sent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};

export default function GreetingsContent() {
  const canManage = useCan('send-messages');
  const queryClient = useQueryClient();
  const [composePreset, setComposePreset] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OccasionGreeting | null>(null);
  const [sendTarget, setSendTarget] = useState<OccasionGreeting | null>(null);

  const greetingsQuery = useQuery({
    queryKey: ['occasion-greetings'],
    queryFn: () => api<OccasionGreeting[]>('/api/greetings'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/greetings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const today = useMemo(() => new Date(), []);
  const upcoming = useMemo(() => upcomingOccasions(today).slice(0, 6), [today]);

  const greetings = greetingsQuery.data ?? [];

  if (greetingsQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Festival and occasion greetings, written in your agency&apos;s voice
          and broadcast to your clients with a festive card image.
          <InfoHint
            text={`AI composing costs ${AI_FEATURE_COSTS.greetings_generate} cr per greeting (text + card image, refunded if the text fails). Sends go out on the shared occasion_greeting WhatsApp template — Meta reviews it once per account, then every occasion reuses it. Contacts who replied STOP ALERTS are excluded automatically.`}
          />
        </p>
        <GatedButton
          canAct={canManage}
          gateReason="create greetings"
          onClick={() => {
            setComposePreset(null);
            setComposeOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Greeting
        </GatedButton>
      </div>

      {upcoming.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {upcoming.map(({ occasion, date }) => {
            const days = daysUntil(date, today);
            return (
              <button
                key={occasion.id}
                disabled={!canManage}
                onClick={() => {
                  setComposePreset(occasion.id);
                  setComposeOpen(true);
                }}
                className="hover:border-primary/50 flex min-w-36 shrink-0 flex-col items-start gap-0.5 rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-2.5 text-left transition-colors disabled:cursor-default"
              >
                <span className="text-lg">{occasion.emoji}</span>
                <span className="text-sm font-medium text-white">
                  {occasion.label}
                </span>
                <span className="text-xs text-slate-500">
                  {format(date, 'd MMM')} ·{' '}
                  {days === 0
                    ? 'today'
                    : `in ${days} day${days === 1 ? '' : 's'}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {greetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <PartyPopper className="h-8 w-8 text-slate-600" />
          <p className="text-sm font-medium text-slate-300">No greetings yet</p>
          <p className="max-w-md text-xs text-slate-500">
            Pick an upcoming occasion above — the AI writes the greeting in your
            agency&apos;s name and designs the card, ready to broadcast to your
            clients.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {greetings.map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                  {g.image_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={storagePublicUrl(g.image_path)}
                      alt={g.occasion_label}
                      className="h-16 w-16 shrink-0 rounded-lg border border-slate-800 object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-white">
                        {g.occasion_label}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize',
                          STATUS_STYLES[g.status]
                        )}
                      >
                        {g.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                      {g.message_text}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {g.sent_at
                        ? `Sent ${format(new Date(g.sent_at), 'd MMM yyyy, h:mm a')}`
                        : `Created ${format(new Date(g.created_at), 'd MMM yyyy')}`}
                      {g.broadcast_id && (
                        <Link
                          href={`/broadcasts/${g.broadcast_id}`}
                          className="text-primary ml-2 inline-flex items-center gap-1 hover:underline"
                        >
                          View delivery
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <GatedButton
                    canAct={canManage}
                    gateReason="send greetings"
                    size="sm"
                    onClick={() => setSendTarget(g)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {g.status === 'sent' ? 'Send again' : 'Send'}
                  </GatedButton>
                  <GatedButton
                    canAct={canManage}
                    gateReason="edit greetings"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditTarget(g)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </GatedButton>
                  <GatedButton
                    canAct={canManage}
                    gateReason="delete greetings"
                    size="sm"
                    variant="ghost"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the "${g.occasion_label}" greeting?`
                        )
                      ) {
                        deleteMutation.mutate(g.id);
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

      <ComposeGreetingDialog
        open={composeOpen}
        presetOccasionId={composePreset}
        onOpenChange={setComposeOpen}
      />
      <EditGreetingDialog
        greeting={editTarget}
        onClose={() => setEditTarget(null)}
      />
      <SendGreetingDialog
        greeting={sendTarget}
        onClose={() => setSendTarget(null)}
      />
    </div>
  );
}

function ComposeGreetingDialog({
  open,
  presetOccasionId,
  onOpenChange,
}: {
  open: boolean;
  presetOccasionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [occasionId, setOccasionId] = useState<string>(
    presetOccasionId ?? OCCASIONS[0].id
  );
  const [customLabel, setCustomLabel] = useState('');
  const [tone, setTone] = useState<GreetingTone>('warm');
  const [notes, setNotes] = useState('');
  const [withImage, setWithImage] = useState(true);
  const [message, setMessage] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lastPreset, setLastPreset] = useState<string | null>(null);

  if (open && presetOccasionId !== lastPreset) {
    setLastPreset(presetOccasionId);
    if (presetOccasionId) setOccasionId(presetOccasionId);
  }

  const isCustom = occasionId === CUSTOM_OCCASION;
  const occasionLabel = isCustom
    ? customLabel.trim()
    : (OCCASIONS.find((o) => o.id === occasionId)?.label ?? '');

  const reset = () => {
    setMessage('');
    setImagePath(null);
    setImageUrl(null);
    setNotes('');
    setCustomLabel('');
    setLastPreset(null);
  };

  const generateMutation = useMutation({
    mutationFn: () =>
      api<{ text: string; imagePath: string | null; imageUrl: string | null }>(
        '/api/greetings/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            occasion: occasionLabel,
            tone,
            notes: notes.trim() || undefined,
            generateImage: withImage,
          }),
        }
      ),
    onSuccess: (result) => {
      setMessage(result.text);
      // Always replace, never merge: a second compose with images off —
      // or one whose image failed — would otherwise keep the previous
      // occasion's card and attach it to the new greeting.
      setImagePath(result.imagePath);
      setImageUrl(result.imageUrl);
      if (withImage && !result.imagePath) {
        toast.info('Card image could not be generated — the text is ready.');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api<OccasionGreeting>('/api/greetings', {
        method: 'POST',
        body: JSON.stringify({
          occasionId: isCustom ? undefined : occasionId,
          occasionLabel,
          messageText: message,
          imagePath: imagePath ?? undefined,
        }),
      }),
    onSuccess: () => {
      toast.success('Greeting saved — send it whenever you are ready.');
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      onOpenChange(false);
      reset();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New occasion greeting</DialogTitle>
          <DialogDescription>
            The AI writes it in your agency&apos;s name and designs a festive
            card — costs {AI_FEATURE_COSTS.greetings_generate} cr per compose.
            You can also write it yourself for free.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gr-occasion">Occasion</Label>
              <select
                id="gr-occasion"
                value={occasionId}
                onChange={(e) => setOccasionId(e.target.value)}
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                {OCCASIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.emoji} {o.label}
                  </option>
                ))}
                <option value={CUSTOM_OCCASION}>✍️ Custom occasion…</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gr-tone">Tone</Label>
              <select
                id="gr-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as GreetingTone)}
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white capitalize focus:outline-none"
              >
                {GREETING_TONES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isCustom && (
            <div className="space-y-1.5">
              <Label htmlFor="gr-custom">Occasion name</Label>
              <Input
                id="gr-custom"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Our 10th Anniversary"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="gr-notes">Anything to include? (optional)</Label>
            <Input
              id="gr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. mention that our office is closed on the day"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={withImage}
                onChange={(e) => setWithImage(e.target.checked)}
                className="accent-primary h-4 w-4"
              />
              Design a festive card image
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!occasionLabel || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generateMutation.isPending
                ? 'Composing…'
                : message
                  ? 'Compose again'
                  : 'Compose with AI'}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gr-message">Greeting message</Label>
            <Textarea
              id="gr-message"
              value={message}
              onChange={(e) =>
                setMessage(e.target.value.slice(0, GREETING_MESSAGE_MAX))
              }
              rows={4}
              placeholder="Wishing you and your family a joyous festival…"
            />
            <p className="text-right text-xs text-slate-500">
              {message.length}/{GREETING_MESSAGE_MAX}
            </p>
          </div>
          {imageUrl && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Greeting card"
                className="h-24 w-24 rounded-lg border border-slate-800 object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setImagePath(null);
                  setImageUrl(null);
                }}
              >
                Remove card
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !occasionLabel || !message.trim() || saveMutation.isPending
            }
            onClick={() => saveMutation.mutate()}
          >
            Save greeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditGreetingDialog({
  greeting,
  onClose,
}: {
  greeting: OccasionGreeting | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (greeting && greeting.id !== loadedId) {
    setLoadedId(greeting.id);
    setMessage(greeting.message_text);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api<OccasionGreeting>(`/api/greetings/${greeting!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ messageText: message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      setLoadedId(null);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog
      open={Boolean(greeting)}
      onOpenChange={(open) => {
        if (!open) {
          setLoadedId(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit “{greeting?.occasion_label}” greeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="gr-edit">Greeting message</Label>
          <Textarea
            id="gr-edit"
            value={message}
            onChange={(e) =>
              setMessage(e.target.value.slice(0, GREETING_MESSAGE_MAX))
            }
            rows={4}
          />
          <p className="text-right text-xs text-slate-500">
            {message.length}/{GREETING_MESSAGE_MAX}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!message.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendGreetingDialog({
  greeting,
  onClose,
}: {
  greeting: OccasionGreeting | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const [audienceType, setAudienceType] = useState<'all' | 'tags'>('all');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [optedInOnly, setOptedInOnly] = useState(false);

  const templateQuery = useQuery({
    queryKey: ['occasion-greeting-template'],
    queryFn: () => api<TemplateState>('/api/greetings/template'),
    enabled: Boolean(greeting),
  });

  // Counted in SQL (migration 284), not with a client-side
  // count: 'exact' over the account's contacts — see AGENTS.md §2.6.
  const optedInCountQuery = useQuery({
    queryKey: ['contacts', 'consent-counts'],
    queryFn: async () =>
      (await api<{ granted: number }>('/api/contacts/consent-counts')).granted,
    enabled: Boolean(greeting),
  });

  const tagsQuery = useQuery({
    queryKey: ['occasion-greetings', 'tags', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('tags')
        .select('id, name')
        .order('name');
      return (data ?? []) as TagRow[];
    },
    enabled: Boolean(greeting) && Boolean(accountId),
  });

  const setupMutation = useMutation({
    mutationFn: () =>
      api<{ status: string | null }>('/api/greetings/template', {
        method: 'POST',
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['occasion-greeting-template'],
      });
      toast.success(
        result.status === 'PENDING'
          ? 'Greeting template submitted to Meta for approval.'
          : 'Greeting template checked.'
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api<{ broadcastId: string; recipientsCount: number }>(
        `/api/greetings/${greeting!.id}/send`,
        {
          method: 'POST',
          body: JSON.stringify({
            audience:
              audienceType === 'tags'
                ? { type: 'tags', tagIds }
                : { type: 'all' },
            optedInOnly,
          }),
        }
      ),
    onSuccess: (result) => {
      toast.success(
        `Greeting is going out to ${result.recipientsCount} contact${result.recipientsCount === 1 ? '' : 's'}.`
      );
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      setTagIds([]);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const template = templateQuery.data;
  const approved = template?.status === 'APPROVED';

  const canSend = approved && (audienceType === 'all' || tagIds.length > 0);

  return (
    <Dialog
      open={Boolean(greeting)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send “{greeting?.occasion_label}” greeting</DialogTitle>
          <DialogDescription>
            Delivered as a WhatsApp template with your card image, addressed to
            each client by name. Contacts who opted out (STOP ALERTS) are
            excluded automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {template && !approved && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              {template.status === null && (
                <>
                  Your account doesn&apos;t have the greeting template yet. It
                  is submitted to Meta once and reused for every occasion.
                  <Button
                    size="sm"
                    className="mt-2 block"
                    disabled={setupMutation.isPending}
                    onClick={() => setupMutation.mutate()}
                  >
                    Set up greeting template
                  </Button>
                </>
              )}
              {template.status === 'PENDING' && (
                <>
                  The greeting template is awaiting Meta approval — sends unlock
                  the moment it is approved.
                </>
              )}
              {template.status === 'REJECTED' && (
                <>
                  Meta rejected the greeting template
                  {template.rejectionReason
                    ? `: ${template.rejectionReason}`
                    : ''}
                  . Edit and resubmit it from Settings → Templates.
                </>
              )}
              {template.status !== null &&
                !['PENDING', 'REJECTED'].includes(template.status) && (
                  <>
                    The greeting template is not usable right now (status:{' '}
                    {template.status}).
                  </>
                )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'all' ? 'default' : 'outline'}
                onClick={() => setAudienceType('all')}
              >
                All contacts
              </Button>
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'tags' ? 'default' : 'outline'}
                onClick={() => setAudienceType('tags')}
              >
                By tags
              </Button>
            </div>
          </div>
          {audienceType === 'tags' && (
            <div className="flex flex-wrap gap-1.5">
              {(tagsQuery.data ?? []).map((tag) => {
                const active = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setTagIds((prev) =>
                        active
                          ? prev.filter((id) => id !== tag.id)
                          : [...prev, tag.id]
                      )
                    }
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      active
                        ? 'border-primary bg-primary/15 text-white'
                        : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                    )}
                  >
                    {tag.name}
                  </button>
                );
              })}
              {tagsQuery.data?.length === 0 && (
                <p className="text-xs text-slate-500">
                  No tags yet — tag contacts first, or send to all.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={optedInOnly}
                onChange={(e) => setOptedInOnly(e.target.checked)}
                className="accent-primary h-4 w-4"
              />
              Only clients who explicitly opted in
              {typeof optedInCountQuery.data === 'number' && (
                <span className="text-xs text-slate-500">
                  ({optedInCountQuery.data} opted in)
                </span>
              )}
            </label>
            <p className="text-xs text-slate-500">
              Clients are asked to opt in the first time they message you on
              WhatsApp, and portal enquiry forms record consent too. Without
              this, the greeting goes to everyone except contacts who replied
              STOP ALERTS.
            </p>
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
            Send greeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
