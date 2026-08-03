'use client';

// ============================================================
// /i/[token] — beta invite landing page.
//
// Separate from /join/[token], which is team invites. That one adds
// a person to an existing account; this one authorizes creating a
// new one. Different mechanism, different URL space.
//
// Five states, driven entirely by the peek result:
//
//   ok            → the seat pass. Claim → /signup?beta=<token>
//   expired       → inviter named, so there's someone to ask
//   used          → someone got here first
//   revoked /
//   not_found     → generic
//   program_full  → all seats claimed
//
// Every dead-end state ends in waitlist capture, not a wall. An
// invite-only launch produces forwarded links by design, and the
// people who arrive at a spent link are the warmest leads the
// programme makes — dropping them is the single biggest avoidable
// loss here. The waitlist posts to /api/public/engine-lead with
// source=beta_waitlist, so they land in the same sales pipeline as
// every other prospect instead of needing their own table.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { WaitlistForm } from '@/components/beta/waitlist-form';

interface PeekOk {
  ok: true;
  inviter_name: string | null;
  inviter_account: string | null;
  label: string | null;
  expires_at: string;
  seats_taken: number;
  account_cap: number;
  seat_number: number;
}

type FailReason =
  | 'not_found'
  | 'revoked'
  | 'expired'
  | 'used'
  | 'program_full'
  | 'server_error';

interface PeekFail {
  ok: false;
  reason: FailReason;
  inviter_name?: string | null;
  inviter_account?: string | null;
  seats_taken?: number;
  account_cap?: number;
}

type PeekResult = PeekOk | PeekFail;

function daysUntil(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000),
  );
}

export default function BetaInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [peek, setPeek] = useState<PeekResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/beta-invites/${encodeURIComponent(token)}/peek`,
        );
        const data = (await res.json()) as PeekResult;
        if (!cancelled) setPeek(data);
      } catch {
        if (!cancelled) setPeek({ ok: false, reason: 'server_error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!peek) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-7">
        <header className="flex items-baseline justify-between border-b border-slate-800/70 pb-4">
          <p className="font-serif text-lg">
            <span className="font-bold">Convo</span>
            <span className="text-slate-400">Real</span>
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Private beta
          </p>
        </header>

        {peek.ok ? (
          <SeatPass peek={peek} token={token} />
        ) : (
          <DeadEnd peek={peek} />
        )}
      </div>
    </div>
  );
}

function SeatPass({ peek, token }: { peek: PeekOk; token: string }) {
  const inviter = peek.inviter_name?.trim() || 'The ConvoReal team';
  const days = daysUntil(peek.expires_at);

  return (
    <main className="flex flex-col gap-7">
      <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="relative p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            Invitation
          </p>

          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Allotted to you by
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-white">
            {inviter}
            {peek.inviter_account ? (
              <span className="block text-sm font-normal text-slate-400">
                {peek.inviter_account}
              </span>
            ) : null}
          </h1>

          <div className="mt-6 flex items-baseline gap-2.5 border-t border-slate-800/70 pt-5">
            <span className="text-6xl font-bold leading-none tabular-nums text-white">
              {String(peek.seat_number).padStart(3, '0')}
            </span>
            <span className="text-sm tabular-nums text-slate-400">
              of {peek.account_cap}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            ConvoReal opens to {peek.account_cap} property consultants this month. This
            is one of them.
          </p>

          <div
            aria-hidden
            className="absolute right-5 top-5 flex size-20 -rotate-12 flex-col items-center justify-center rounded-full border border-primary/60 text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.11em] text-primary"
          >
            Held for
            <b className="block text-lg font-bold leading-tight">{days}</b>
            days
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-dashed border-slate-800 bg-slate-950/60 px-6 py-4">
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
              Expires
            </dt>
            <dd className="mt-1 font-mono text-sm text-amber-400">
              {new Date(peek.expires_at).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
              Seats left
            </dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-slate-300">
              {Math.max(0, peek.account_cap - peek.seats_taken)}
            </dd>
          </div>
        </dl>
      </article>

      <section className="grid gap-6 border-y border-slate-800/70 py-6 sm:grid-cols-2">
        <div>
          <h2 className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
            What you get
          </h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm text-slate-300">
            <Bullet>
              <b className="text-white">Every feature, free</b> through the
              beta — inbox, inventory, matching, campaigns.
            </Bullet>
            <Bullet>
              <b className="text-white">A direct line</b> to the people
              building it, not a ticket queue.
            </Bullet>
            <Bullet>
              <b className="text-white">Five seats of your own</b> to hand to
              consultants you rate.
            </Bullet>
            <Bullet>
              <b className="text-white">A free Portfolio for your owners &amp;
              buyers</b> — they track interest and matches themselves; every
              deal still runs through you.
            </Bullet>
          </ul>
        </div>
        <div>
          <h2 className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
            What we ask
          </h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm text-slate-300">
            <Bullet warm>
              <b className="text-white">Use it for real work.</b> Real
              listings, real buyers — a demo account teaches us nothing.
            </Bullet>
            <Bullet warm>
              <b className="text-white">Tell us what breaks.</b> There&apos;s
              a Report a bug button on every screen.
            </Bullet>
            <Bullet warm>
              <b className="text-white">Stay a month.</b> Long enough for the
              rough edges to show.
            </Bullet>
          </ul>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <p className="text-center text-sm leading-relaxed text-slate-300">
          The AI era of real estate is here — this Engine is what turns a
          broker into a{' '}
          <b className="text-white">professional consultant</b>. Don&apos;t get
          left behind.
        </p>
        <Link href={`/signup?beta=${encodeURIComponent(token)}`}>
          <Button className="h-12 w-full text-base font-semibold">
            Claim seat {String(peek.seat_number).padStart(3, '0')}
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </Link>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
          <ShieldCheck className="size-3.5 shrink-0" />
          Takes about two minutes. You&apos;ll verify your WhatsApp number —
          that&apos;s how enquiries reach you.
        </p>
      </div>
    </main>
  );
}

function Bullet({
  children,
  warm,
}: {
  children: React.ReactNode;
  warm?: boolean;
}) {
  return (
    <li className="relative pl-4 leading-relaxed">
      <span
        aria-hidden
        className={`absolute left-0 top-2 size-1.5 rounded-full ${
          warm ? 'bg-amber-500' : 'bg-primary'
        }`}
      />
      {children}
    </li>
  );
}

const DEAD_END_COPY: Record<
  Exclude<FailReason, 'server_error'>,
  { tag: string; title: string; body: (inviter: string) => string }
> = {
  expired: {
    tag: 'Seat released',
    title: 'This seat went back into the pool.',
    body: (inviter) =>
      `Invitations are held for a fortnight so seats don't sit idle. Ask ${inviter} for a fresh link — it takes a few seconds — or leave your number and we'll come to you if one frees up.`,
  },
  used: {
    tag: 'Already claimed',
    title: 'Someone got here first.',
    body: () =>
      "This link has already been claimed. If that was you, sign in instead. If it was forwarded to you, leave your number — forwarded invitations are how we find most of the people we actually want.",
  },
  revoked: {
    tag: 'Invitation withdrawn',
    title: 'This invitation was withdrawn.',
    body: (inviter) =>
      `${inviter} took this seat back, usually because it was meant for someone else. Ask them for a fresh link, or leave your number below.`,
  },
  not_found: {
    tag: 'Link not recognised',
    title: "We can't find that invitation.",
    body: () =>
      "Double-check the link — it's easy to lose a character when a message gets forwarded. Or leave your number and we'll reach out when a seat opens.",
  },
  program_full: {
    tag: 'Wave one closed',
    title: 'All the seats are taken.',
    body: () =>
      "Wave one is full and we're not stretching it — this is as many consultants as we can support properly this month. Wave two opens when this one settles. Leave your number and you'll be near the front of it.",
  },
};

function DeadEnd({ peek }: { peek: PeekFail }) {
  const reason = peek.reason === 'server_error' ? 'not_found' : peek.reason;
  const copy = DEAD_END_COPY[reason];
  const inviter = peek.inviter_name?.trim() || 'whoever invited you';

  return (
    <main className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">
        {copy.tag}
      </p>
      <h1 className="text-2xl font-semibold leading-tight text-white">
        {copy.title}
      </h1>
      <p className="text-sm leading-relaxed text-slate-300">
        {copy.body(inviter)}
      </p>

      <WaitlistForm inviteState={peek.reason} />

      {typeof peek.seats_taken === 'number' &&
      typeof peek.account_cap === 'number' ? (
        <p className="border-t border-slate-800/70 pt-4 font-mono text-xs tabular-nums text-slate-500">
          {peek.seats_taken} of {peek.account_cap} seats claimed
        </p>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:text-primary/80">
          Sign in
        </Link>
      </p>
    </main>
  );
}
