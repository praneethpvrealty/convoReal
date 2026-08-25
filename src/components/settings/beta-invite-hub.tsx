'use client';

// ============================================================
// Settings → Invites — the account's beta seats.
//
// One card per seat, each in one of three states: empty (generate),
// pending (copy / share / revoke), claimed (who took it, when).
// Modelled on invite-member-dialog.tsx so it needs no new UI
// vocabulary.
//
// The link is shown exactly once, when it's generated — the row
// stores only the SHA-256 hash, so the API physically cannot return
// it again. A resend rotates the row to a fresh token, invalidating
// the old link while preserving the person, phone and quota seat.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Plus,
  RotateCw,
  Ticket,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { betaInviteWhatsAppUrl } from '@/lib/beta/invites';
import { toAuthPhone } from '@/lib/whatsapp/phone-utils';

interface BetaInvite {
  id: string;
  code: string;
  label: string | null;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  seat_number: number | null;
  invitee_phone: string | null;
}

interface Program {
  account_cap: number;
  seats_taken: number;
  invite_ttl_days: number;
  issuance_open: boolean;
}

interface IssuedLink {
  id: string;
  code: string;
  url: string;
  inviteePhone: string | null;
  shareMessage: string;
}

export function BetaInviteHub() {
  const [invites, setInvites] = useState<BetaInvite[]>([]);
  const [quota, setQuota] = useState(5);
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [inviteePhone, setInviteePhone] = useState('');
  const [fresh, setFresh] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/beta-invites');
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error || 'Could not load your invitations');
        return;
      }
      const data = (await res.json()) as {
        invites: BetaInvite[];
        quota: number;
        program: Program | null;
      };
      setInvites(data.invites);
      setQuota(data.quota);
      setProgram(data.program);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = useCallback(async () => {
    const normalizedPhone = inviteePhone.trim()
      ? toAuthPhone(inviteePhone)
      : null;
    if (inviteePhone.trim() && !normalizedPhone) {
      toast.error('Enter a valid WhatsApp number, including country code.');
      return;
    }

    setIssuing(true);
    try {
      const res = await fetch('/api/beta-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || null,
          invitee_phone: normalizedPhone,
        }),
      });
      const data = (await res.json()) as IssuedLink & { error?: string };
      if (!res.ok) {
        toast.error(data.error || 'Could not create an invitation');
        return;
      }
      setFresh(data);
      setCopied(false);
      setLabel('');
      setInviteePhone('');
      await load();
    } catch {
      toast.error('Could not create an invitation — check your connection.');
    } finally {
      setIssuing(false);
    }
  }, [inviteePhone, label, load]);

  const revoke = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/beta-invites/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || 'Could not revoke that invitation');
        return;
      }
      toast.success('Invitation revoked — the seat is back in your pool.');
      if (fresh?.id === id) setFresh(null);
      await load();
    },
    [fresh, load]
  );

  const resend = useCallback(
    async (invite: BetaInvite) => {
      const popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      setResendingId(invite.id);
      try {
        const res = await fetch(`/api/beta-invites/${invite.id}`, {
          method: 'POST',
        });
        const data = (await res.json()) as IssuedLink & { error?: string };
        if (!res.ok) {
          popup?.close();
          toast.error(data.error || 'Could not resend that invitation');
          return;
        }

        await load();
        const whatsappUrl = betaInviteWhatsAppUrl(
          data.shareMessage,
          data.inviteePhone
        );
        if (popup) {
          popup.location.href = whatsappUrl;
          setFresh(null);
          toast.success(
            'Fresh link created. The previous link no longer works.'
          );
        } else {
          setFresh(data);
          setCopied(false);
          toast.info('Fresh link ready — tap Share on WhatsApp.');
        }
      } catch {
        popup?.close();
        toast.error('Could not resend the invitation — check your connection.');
      } finally {
        setResendingId(null);
      }
    },
    [load]
  );

  const copyLink = useCallback(async () => {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh.url);
    setCopied(true);
    toast.success('Link copied');
  }, [fresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/50 py-14">
        <Loader2 className="size-5 animate-spin text-slate-500" />
      </div>
    );
  }

  const used = invites.length;
  const remaining = Math.max(0, quota - used);
  const seatsLeft = program
    ? Math.max(0, program.account_cap - program.seats_taken)
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Ticket className="text-primary size-4" />
              Your invitations
            </h2>
            <p className="mt-1 max-w-prose text-sm text-slate-400">
              You have <b className="text-white">{remaining}</b> of {quota}{' '}
              seats left to hand out. Give them to consultants you&apos;d
              actually vouch for — that&apos;s the whole point of an invite-only
              beta.
            </p>
          </div>
          {seatsLeft !== null && (
            <div className="text-right">
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {seatsLeft}
              </p>
              <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
                seats left in beta
              </p>
            </div>
          )}
        </div>

        {program && !program.issuance_open && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-300">
            Invitations are closed for now. Links already sent still work.
          </p>
        )}

        {remaining > 0 && program?.issuance_open !== false && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="beta-invite-label"
                className="text-xs text-slate-400"
              >
                Name or note
              </Label>
              <Input
                id="beta-invite-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Ravi — Prestige, Whitefield"
                className="border-slate-700 bg-slate-950 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="beta-invite-phone"
                className="text-xs text-slate-400"
              >
                WhatsApp number{' '}
                <span className="text-slate-600">(optional)</span>
              </Label>
              <Input
                id="beta-invite-phone"
                type="tel"
                inputMode="tel"
                value={inviteePhone}
                onChange={(e) => setInviteePhone(e.target.value)}
                placeholder="e.g. +91 99002 77111"
                className="border-slate-700 bg-slate-950 text-white placeholder:text-slate-500"
              />
            </div>
            <p className="text-xs leading-relaxed text-slate-500 sm:col-span-2">
              When supplied, this invite can only finish onboarding after that
              number is verified by WhatsApp OTP.
            </p>
            <Button
              onClick={() => void issue()}
              disabled={issuing}
              className="sm:col-start-2 sm:justify-self-end"
            >
              {issuing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Plus className="size-4" />
                  Generate link
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {fresh && (
        <div className="border-primary/40 bg-primary/5 flex flex-col gap-3 rounded-xl border p-5">
          <div>
            <p className="text-primary font-mono text-[10px] tracking-[0.16em] uppercase">
              {fresh.code} · copy this now
            </p>
            <p className="mt-1 text-sm text-slate-300">
              For security, this link is visible only until you share or dismiss
              it. Need it later? Use Resend beside the person below — that
              creates a fresh link and invalidates this one.
            </p>
          </div>

          <code className="block overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-xs whitespace-nowrap text-slate-200">
            {fresh.url}
          </code>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => void copyLink()}
              className="flex-1 border-slate-700"
            >
              {copied ? (
                <Check className="text-primary size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a
              href={betaInviteWhatsAppUrl(
                fresh.shareMessage,
                fresh.inviteePhone
              )}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setFresh(null)}
              className="flex-1"
            >
              <Button className="w-full">
                <MessageCircle className="size-4" />
                Share on WhatsApp
              </Button>
            </a>
          </div>
          <button
            type="button"
            onClick={() => setFresh(null)}
            className="self-center text-xs text-slate-500 hover:text-slate-300"
          >
            I&apos;ve saved it — hide this
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {invites.map((inv) => (
          <SeatRow
            key={inv.id}
            invite={inv}
            resending={resendingId === inv.id}
            onResend={() => void resend(inv)}
            onRevoke={() => void revoke(inv.id)}
          />
        ))}

        {Array.from({ length: remaining }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 rounded-xl border border-dashed border-slate-800 px-4 py-3.5 text-sm text-slate-500"
          >
            <Ticket className="size-4 shrink-0" />
            Unused seat
          </div>
        ))}
      </div>
    </div>
  );
}

function SeatRow({
  invite,
  resending,
  onResend,
  onRevoke,
}: {
  invite: BetaInvite;
  resending: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const claimed = invite.status === 'accepted';
  const expired = !claimed && new Date(invite.expires_at) <= new Date();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {invite.label || 'Unnamed invitation'}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
          {invite.code}
          {claimed && invite.accepted_at
            ? ` · claimed ${new Date(invite.accepted_at).toLocaleDateString()}`
            : expired
              ? ' · expired'
              : ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`}
        </p>
        {invite.invitee_phone ? (
          <p className="mt-1 text-xs text-slate-400">
            Reserved for {invite.invitee_phone}
          </p>
        ) : null}
      </div>

      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
          claimed
            ? 'bg-primary/15 text-primary'
            : expired
              ? 'bg-slate-800 text-slate-400'
              : 'bg-amber-500/15 text-amber-400'
        }`}
      >
        {claimed
          ? invite.seat_number
            ? `Seat ${invite.seat_number}`
            : 'Claimed'
          : expired
            ? 'Expired'
            : 'Waiting'}
      </span>

      {!claimed && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onResend}
            disabled={resending}
            className="border-slate-700"
          >
            {resending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            Resend
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRevoke}
            className="text-slate-500 hover:text-red-400"
            aria-label="Revoke invitation"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
