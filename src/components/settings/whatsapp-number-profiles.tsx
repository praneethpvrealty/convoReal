'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeftRight,
  Check,
  Loader2,
  Pencil,
  Phone,
  Trash2,
  X,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import type { WhatsAppNumberProfile } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface WhatsAppNumberProfilesProps {
  activePhoneNumberId: string | null;
  refreshToken: string | null;
  onSwitched: () => Promise<void> | void;
}

interface ActivateResult {
  profile: WhatsAppNumberProfile;
  already_active: boolean;
  waba_changed: boolean;
  phone_info: { verified_name?: string; display_phone_number?: string } | null;
}

export const NUMBER_PROFILES_QUERY_KEY = ['whatsapp-number-profiles'] as const;

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

export function profileTitle(profile: WhatsAppNumberProfile): string {
  return (
    profile.label ||
    profile.verified_name ||
    profile.display_phone_number ||
    profile.phone_number_id
  );
}

export function WhatsAppNumberProfiles({
  activePhoneNumberId,
  refreshToken,
  onSwitched,
}: WhatsAppNumberProfilesProps) {
  const canManage = useCan('edit-settings');
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const profilesQuery = useQuery({
    queryKey: [...NUMBER_PROFILES_QUERY_KEY, activePhoneNumberId, refreshToken],
    queryFn: () =>
      api<WhatsAppNumberProfile[]>('/api/whatsapp/config/profiles'),
  });
  const profiles = profilesQuery.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: NUMBER_PROFILES_QUERY_KEY });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      api<ActivateResult>(`/api/whatsapp/config/profiles/${id}/activate`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      if (result.already_active) {
        toast.info('That number is already live.');
      } else {
        toast.success(
          `Switched to ${profileTitle(result.profile)}. Messages to this number now reach ConvoReal.`
        );
        if (result.waba_changed) {
          toast.info(
            'This number belongs to a different WhatsApp Business Account. Sync templates before sending.',
            { duration: 10000 }
          );
        }
      }
      await invalidate();
      await onSwitched();
    },
    onError: (err: Error) => toast.error(err.message, { duration: 10000 }),
  });

  const renameMutation = useMutation({
    mutationFn: (args: { id: string; label: string }) =>
      api<WhatsAppNumberProfile>('/api/whatsapp/config/profiles', {
        method: 'PATCH',
        body: JSON.stringify(args),
      }),
    onSuccess: async () => {
      setEditingId(null);
      await invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api<{ success: boolean }>(
        `/api/whatsapp/config/profiles?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
    onSuccess: async () => {
      toast.success('Saved number removed.');
      await invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const busy =
    activateMutation.isPending ||
    renameMutation.isPending ||
    deleteMutation.isPending;

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <Phone className="text-primary size-4" />
          Saved numbers
        </CardTitle>
        <CardDescription className="text-slate-400">
          Every Official API number you connect stays here with its
          registration. Switch between them without the PIN. Only one number is
          live at a time; WhatsApp messages to the others are not delivered to
          ConvoReal until you switch back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {profilesQuery.isPending ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-slate-500" />
          </div>
        ) : profilesQuery.isError ? (
          <p className="text-sm text-red-300">
            Could not load saved numbers: {profilesQuery.error.message}
          </p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-slate-400">
            No saved numbers yet. Save Official API credentials below and the
            number is added here automatically.
          </p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((profile) => {
              const isEditing = editingId === profile.id;
              return (
                <li
                  key={profile.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3',
                    profile.is_active
                      ? 'border-emerald-700/60 bg-emerald-950/20'
                      : 'border-slate-700 bg-slate-800/60'
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            renameMutation.mutate({
                              id: profile.id,
                              label: draftLabel,
                            });
                          }}
                        >
                          <Input
                            autoFocus
                            maxLength={60}
                            value={draftLabel}
                            onChange={(e) => setDraftLabel(e.target.value)}
                            placeholder="Label, e.g. Sales desk"
                            className="h-8 w-56 border-slate-700 bg-slate-900 text-white"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-emerald-300"
                            disabled={renameMutation.isPending}
                            aria-label="Save label"
                          >
                            {renameMutation.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-slate-400"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel"
                          >
                            <X className="size-4" />
                          </Button>
                        </form>
                      ) : (
                        <span className="truncate font-semibold text-white">
                          {profileTitle(profile)}
                        </span>
                      )}
                      {profile.is_active ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300">
                          Live
                        </Badge>
                      ) : profile.registered_at ? (
                        <Badge
                          variant="outline"
                          className="border-slate-600 text-slate-300"
                        >
                          Registered
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-600/60 text-amber-300"
                        >
                          Not registered
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {profile.display_phone_number
                        ? `${profile.display_phone_number} · `
                        : ''}
                      ID {profile.phone_number_id}
                      {profile.waba_id ? ` · WABA ${profile.waba_id}` : ''}
                    </p>
                    {profile.last_activated_at && (
                      <p className="text-[11px] text-slate-500">
                        Last live{' '}
                        {new Date(profile.last_activated_at).toLocaleString()}
                      </p>
                    )}
                    {!profile.is_active && profile.last_registration_error && (
                      <p className="text-[11px] text-amber-300">
                        Last registration attempt failed:{' '}
                        {profile.last_registration_error}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      {!isEditing && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-slate-400 hover:text-white"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(profile.id);
                            setDraftLabel(profile.label);
                          }}
                          aria-label="Rename"
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {!profile.is_active && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-slate-400 hover:text-red-300"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove ${profileTitle(profile)} from saved numbers? You will need its token and PIN to add it again.`
                                )
                              ) {
                                deleteMutation.mutate(profile.id);
                              }
                            }}
                            aria-label="Remove"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={busy}
                            onClick={() => activateMutation.mutate(profile.id)}
                          >
                            {activateMutation.isPending &&
                            activateMutation.variables === profile.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <ArrowLeftRight className="size-3.5" />
                            )}
                            Switch to this number
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs leading-relaxed text-slate-500">
          To add another number, enter its credentials and two-step PIN in the
          form below and save. The number you are switching away from stays
          saved here. Templates and Flows belong to the WhatsApp Business
          Account, so a number on a different account needs a template sync
          after switching.
        </p>
      </CardContent>
    </Card>
  );
}
