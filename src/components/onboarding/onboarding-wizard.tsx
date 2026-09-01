'use client';

// ============================================================
// First-run wizard for consultants. Assumes a user who has never
// touched a CRM: every step explains WHY before HOW, carries an
// illustration (upgraded to a walkthrough video via the media
// registry once recorded), and offers one clearly-recommended
// action plus an escape hatch.
//
// The three tracked steps mirror /api/onboarding/status —
// WhatsApp connected, first property, first lead — and the
// WhatsApp step hands off to the guided Meta setup at
// /settings/whatsapp-setup rather than dumping a naive user into
// a credentials form.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import {
  MessageCircle,
  Building2,
  Users,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  RefreshCw,
  FileSpreadsheet,
  FileCheck2,
  Forward,
  Bot,
  BookOpen,
  Compass,
  Copy,
  KeyRound,
  Mail,
  Ticket,
  Upload,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepMedia } from '@/components/onboarding/step-media';
import {
  ChatIllustration,
  EmailLeadIllustration,
  PropertyParseIllustration,
  ImportBuyersIllustration,
  TemplateApprovalIllustration,
} from '@/components/onboarding/illustrations';
import { createClient } from '@/lib/supabase/client';
import { buildPropertyAlertTemplatePayload } from '@/lib/whatsapp/property-alert-template';
import { buildCallUpdateTemplatePayload } from '@/lib/whatsapp/call-update-template';
import { buildLocationRevealTemplatePayload } from '@/lib/whatsapp/location-reveal-template';
import {
  buildOwnerDigestTemplatePayload,
  buildOwnerDigestConsentTemplatePayload,
} from '@/lib/whatsapp/owner-digest-template';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import type { MessageTemplate } from '@/types';
import type { OnboardingStatus } from '@/hooks/useOnboarding';
import { CONVOREAL_QUICK_START_GUIDE_URL } from '@/lib/beta/invites';

interface Props {
  status: OnboardingStatus;
  onDismiss: () => void;
  onRefresh: () => Promise<void>;
  onSkipEmailLeads: () => void;
}

function HowItWorks({
  items,
}: {
  items: { icon: React.ReactNode; label: string; sub: string }[];
}) {
  return (
    <div className="space-y-2">
      {items.map((step, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60">
            {step.icon}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{step.label}</p>
            <p className="mt-0.5 text-xs text-slate-400">{step.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="bg-primary/15 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
          <Compass className="text-primary h-8 w-8" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Welcome — here&apos;s how ConvoReal works
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Your whole business runs through one WhatsApp number. Buyers message
          it, listings go out from it, and everything lands here — organised,
          searchable, and followed up automatically.
        </p>
      </div>

      <StepMedia slug="engine-welcome" title="How ConvoReal works">
        <ChatIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <MessageCircle className="size-4 text-emerald-400" />,
            label: '1 · Connect your WhatsApp number',
            sub: 'One-time setup. We walk you through every screen — no tech knowledge needed.',
          },
          {
            icon: <Building2 className="size-4 text-blue-400" />,
            label: '2 · Add your first property',
            sub: 'Forward any listing message and AI turns it into a shareable page.',
          },
          {
            icon: <Users className="size-4 text-violet-400" />,
            label: '3 · Bring in your buyers',
            sub: 'Import your list once — matching starts immediately. New enquiries add themselves.',
          },
          {
            icon: <Globe className="size-4 text-cyan-400" />,
            label: '4 · Make your Showcase yours',
            sub: 'Optional: add your agency services, articles and preferred public style when the basics are ready.',
          },
        ]}
      />

      <Button className="w-full gap-2" onClick={onNext}>
        Start setup — takes a few minutes <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        className="w-full gap-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        onClick={() => window.open(CONVOREAL_QUICK_START_GUIDE_URL, '_blank')}
      >
        <BookOpen className="h-4 w-4" /> Read or share the quick-start PDF
      </Button>
    </div>
  );
}

// ── Step 1: Connect WhatsApp ──────────────────────────────────────────────────

function StepWhatsApp({
  done,
  onDone,
  onRefresh,
}: {
  done: boolean;
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
          <MessageCircle className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">Connect WhatsApp</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          This is the only technical step, and you don&apos;t have to do it
          alone. Our guided setup walks you through Meta&apos;s screens one at a
          time, with pictures of exactly what to click — or we can do the whole
          thing for you.
        </p>
      </div>

      <StepMedia slug="engine-connect-whatsapp" title="Connect WhatsApp">
        <ChatIllustration />
      </StepMedia>

      {done ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
            <Check className="size-4" /> WhatsApp is connected
          </div>
          <StarterTemplates />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            className="w-full gap-2"
            onClick={() => window.open('/settings/whatsapp-setup', '_blank')}
          >
            <Compass className="h-4 w-4" /> Open the guided setup
          </Button>
          <Button
            variant="outline"
            className="w-full gap-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => window.open('/settings?tab=whatsapp', '_blank')}
          >
            <KeyRound className="h-4 w-4" /> I already have my API credentials
          </Button>
          <Button
            variant="ghost"
            onClick={checkNow}
            disabled={checking}
            className="w-full gap-2 text-slate-400 hover:text-slate-200"
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> I&apos;ve connected it — check
                now
              </>
            )}
          </Button>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-slate-500 hover:text-slate-300"
        onClick={onDone}
      >
        {done ? 'Continue' : "I'll do this later"}
      </Button>
    </div>
  );
}

// Starter templates — shown once WhatsApp is connected. Every account
// comes pre-loaded with DRAFT templates (the reminder set seeded on
// account creation, plus anything shared from the platform side);
// this submits those drafts and whichever built-ins are missing, so
// Meta's approval latency runs during setup instead of surfacing as
// a broadcast failure later.

function StarterTemplates() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: number; total: number } | null>(
    null
  );

  async function submitAll() {
    setSubmitting(true);
    const builtins = [
      buildPropertyAlertTemplatePayload(window.location.origin),
      buildOwnerDigestConsentTemplatePayload(),
      buildOwnerDigestTemplatePayload(),
      buildLocationRevealTemplatePayload(window.location.origin),
      buildCallUpdateTemplatePayload(),
    ];
    let payloads: TemplatePayload[] = builtins;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('message_templates')
        .select(
          'name, category, language, header_type, header_content, header_media_url, header_handle, body_text, footer_text, buttons, sample_values, status'
        );
      if (data) {
        const rows = data as Partial<MessageTemplate>[];
        const names = new Set(rows.map((t) => t.name));
        const drafts = rows.filter((t) => (t.status || 'DRAFT') === 'DRAFT');
        payloads = [
          ...drafts.map(
            (t): TemplatePayload => ({
              name: t.name!,
              category: t.category!,
              language: t.language || 'en_US',
              header_type: t.header_type,
              header_content: t.header_content,
              header_media_url: t.header_media_url,
              header_handle: t.header_handle,
              body_text: t.body_text!,
              footer_text: t.footer_text,
              buttons: t.buttons,
              sample_values: t.sample_values,
            })
          ),
          ...builtins.filter((b) => !names.has(b.name)),
        ];
      }
    } catch {
      // Draft lookup failed — the built-in set still goes out.
    }
    let ok = 0;
    for (const payload of payloads) {
      try {
        const res = await fetch('/api/whatsapp/templates/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) ok++;
      } catch {
        // Counted as not submitted; the summary below reports it.
      }
    }
    setResult({ ok, total: payloads.length });
    setSubmitting(false);
    if (ok === payloads.length) {
      toast.success(
        'Templates sent to Meta for approval — usually ready within a day.'
      );
    } else {
      toast.error(
        `${ok} of ${payloads.length} templates submitted. Retry the rest from Settings → WhatsApp → Templates.`
      );
    }
  }

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60">
          <FileCheck2 className="size-4 text-amber-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">
            While you&apos;re here — approve your ready-made templates
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            Your account came pre-loaded with message templates — appointment
            and site-visit reminders, a property alert, and owner updates. Meta
            must approve them before they can be sent, and approval can take a
            day. Submit them now: once approved, reminders go out automatically
            and broadcasts can use them.
          </p>

          <StepMedia
            slug="engine-templates"
            title="How template approval works"
            className="mt-3"
          >
            <TemplateApprovalIllustration />
          </StepMedia>

          {result === null ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={submitAll}
                className="gap-1.5 border-slate-700 text-slate-200 hover:bg-slate-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>Submit them for approval</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  window.open('/settings?tab=whatsapp&sub=templates', '_blank')
                }
                className="gap-1 text-slate-400 hover:text-slate-200"
              >
                See them first
              </Button>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="size-3.5" /> {result.ok} of {result.total}{' '}
              submitted — track them in Settings → WhatsApp → Templates
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Add first property ────────────────────────────────────────────────

function StepProperty({
  onDone,
  onRefresh,
}: {
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/15">
          <Building2 className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Add your first property
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          You already have listings sitting in your WhatsApp chats. Forward one
          to your connected number and the AI turns it into a proper listing —
          photos, price, location, everything.
        </p>
      </div>

      <StepMedia
        slug="engine-add-property"
        title="Add a property from WhatsApp"
      >
        <PropertyParseIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <Forward className="size-4 text-blue-400" />,
            label: 'Forward any property listing',
            sub: 'Text, photos, price, location — send it all at once to your ConvoReal number',
          },
          {
            icon: <Bot className="size-4 text-violet-400" />,
            label: 'AI reads the details',
            sub: 'Title, type, price, area, amenities — it shows you a draft to review',
          },
          {
            icon: <Check className="size-4 text-emerald-400" />,
            label: 'Tap Confirm',
            sub: 'The property lands in your inventory with a shareable showcase link — clients can rate it so future matches improve.',
          },
        ]}
      />

      <p className="text-center text-xs text-slate-500">
        Prefer typing? Go to{' '}
        <b className="text-slate-400">Inventory → Add Property</b> and fill the
        form instead — both end up in the same place.
      </p>

      <div className="flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking} className="w-full gap-2">
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> I&apos;ve added one — check now
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-300"
          onClick={onDone}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Bring in your buyers ──────────────────────────────────────────────

function StepBuyers({
  onDone,
  onRefresh,
}: {
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15">
          <Users className="h-8 w-8 text-violet-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Bring in your buyers
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          The matching engine works from your buyer list. Import the buyers you
          already have — from your phone or an Excel sheet — and ConvoReal
          starts matching them against your inventory right away.
        </p>
      </div>

      <StepMedia slug="engine-import-buyers" title="Import your buyer list">
        <ImportBuyersIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <FileSpreadsheet className="size-4 text-emerald-400" />,
            label: 'Export your contacts',
            sub: 'From your phone (Contacts → Export) or the Excel sheet you already keep — any CSV works',
          },
          {
            icon: <Upload className="size-4 text-blue-400" />,
            label: 'Import them in one go',
            sub: 'Contacts → Import maps your columns for you and skips duplicates',
          },
          {
            icon: <Sparkles className="text-primary size-4" />,
            label: 'Matches appear on Radar',
            sub: 'Every buyer is matched against your inventory automatically — see who fits what today',
          },
        ]}
      />

      <p className="text-center text-xs text-slate-500">
        No list yet? No problem — anyone who messages your WhatsApp or opens
        your property links becomes a contact by themselves.
      </p>

      <div className="flex flex-col gap-2">
        <Button
          className="w-full gap-2"
          onClick={() => window.open('/contacts?import=1', '_blank')}
        >
          <Upload className="h-4 w-4" /> Open contact import
        </Button>
        <Button
          variant="ghost"
          onClick={checkNow}
          disabled={checking}
          className="w-full gap-2 text-slate-400 hover:text-slate-200"
        >
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> I&apos;ve imported them — check
              now
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-300"
          onClick={onDone}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Import portal email leads ─────────────────────────────────────────

function StepEmailLeads({
  done,
  onDone,
  onSkip,
  onRefresh,
}: {
  done: boolean;
  onDone: () => void;
  onSkip: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15">
          <Mail className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Bring in your portal leads
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Getting enquiries on 99acres, MagicBricks or Housing? Set one
          forwarding rule in your email — done once, in about two minutes — and
          every portal lead lands here as a WhatsApp contact, replied to within
          seconds.
        </p>
      </div>

      <StepMedia slug="engine-email-leads" title="Portal leads by email">
        <EmailLeadIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <Copy className="size-4 text-amber-400" />,
            label: 'Copy your ConvoReal lead address',
            sub: 'Every account has its own. One click in Settings → Other → Email Lead Sourcing',
          },
          {
            icon: <Forward className="size-4 text-blue-400" />,
            label: 'Add a forwarding rule in Gmail / Outlook',
            sub: 'Forward portal emails to that address — the step-by-step guide is on the same screen, and we confirm the rule for you automatically',
          },
          {
            icon: <Bot className="size-4 text-violet-400" />,
            label: 'Leads arrive by themselves',
            sub: 'Name, phone and budget are read from the email, matched to your inventory, and greeted on WhatsApp if you switch auto-reply on',
          },
        ]}
      />

      {done ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          <Check className="size-4" /> Email lead sync is on
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            className="w-full gap-2"
            onClick={() => window.open('/settings?tab=other', '_blank')}
          >
            <Mail className="h-4 w-4" /> Open email lead setup
          </Button>
          <Button
            variant="ghost"
            onClick={checkNow}
            disabled={checking}
            className="w-full gap-2 text-slate-400 hover:text-slate-200"
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> I&apos;ve set it up — check
                now
              </>
            )}
          </Button>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-slate-500 hover:text-slate-300"
        onClick={done ? onDone : onSkip}
      >
        {done ? 'Continue' : "I don't get leads by email — skip"}
      </Button>
    </div>
  );
}

// ── All done ─────────────────────────────────────────────────────────────────

function AllDone({ onClose }: { onClose: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
        <Sparkles className="h-10 w-10 text-emerald-400" />
      </div>
      <div>
        <h2 className="mb-2 text-2xl font-bold text-white">
          You&apos;re all set! 🎉
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          ConvoReal is ready to go. Leads flow into your inbox, your listings
          are shareable, and everything is tracked in one place. If you&apos;re
          ever stuck, the Copilot button at the bottom-right can walk you
          through any screen.
        </p>
      </div>
      <div className="w-full rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15">
            <Globe className="size-4 text-cyan-300" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              One optional finishing touch: your Showcase
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Choose how your public agency page looks, then add services and
              articles whenever you&apos;re ready. It gives every listing link a
              more complete home.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open('/settings?tab=showcase', '_blank')}
              className="mt-2.5 gap-1.5 border-slate-700 text-slate-200 hover:bg-slate-700"
            >
              <Globe className="size-3.5" /> Set up Showcase
            </Button>
          </div>
        </div>
      </div>
      <div className="border-primary/30 bg-primary/5 w-full rounded-xl border p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="bg-primary/15 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Ticket className="text-primary size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              Know a consultant who&apos;d want in?
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Your account holds beta seats of its own. Hand one to a consultant
              you rate — the beta grows on referrals, not ads.
            </p>

            {/* Video-only slot: nothing renders until a walkthrough is
                registered, so the finish screen stays clean. */}
            <StepMedia
              slug="engine-share-seats"
              title="Sharing your beta seats"
              className="mt-3"
            />

            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open('/settings?tab=invites', '_blank')}
              className="mt-2.5 gap-1.5 border-slate-700 text-slate-200 hover:bg-slate-700"
            >
              <Ticket className="size-3.5" /> Share a seat
            </Button>
          </div>
        </div>
      </div>
      <Button onClick={onClose} className="w-full gap-2">
        Go to Dashboard <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

interface StepDef {
  id: string;
  label: string;
  done: boolean;
}

function StepIndicator({
  steps,
  current,
}: {
  steps: StepDef[];
  current: number;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              step.done
                ? 'bg-emerald-500/20 text-emerald-400'
                : i === current
                  ? 'bg-primary/20 text-primary'
                  : 'bg-slate-800 text-slate-500'
            }`}
          >
            {step.done ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="flex h-3 w-3 items-center justify-center rounded-full border border-current text-[9px]">
                {i + 1}
              </span>
            )}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-4 ${i < current || step.done ? 'bg-primary/40' : 'bg-slate-700'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

// Screen order: welcome (0) → whatsapp (1) → property (2) → lead (3) →
// email leads (4) → done (5). The welcome screen only shows on a completely
// fresh account; a returning user resumes at their first incomplete tracked
// step.

export function OnboardingWizard({
  status,
  onDismiss,
  onRefresh,
  onSkipEmailLeads,
}: Props) {
  function firstIncompleteScreen() {
    if (!status.hasWhatsApp)
      return !status.hasProperties && !status.hasContacts ? 0 : 1;
    if (!status.hasProperties) return 2;
    if (!status.hasContacts) return 3;
    if (!status.hasEmailLeadSync) return 4;
    return 5;
  }

  const [screen, setScreen] = useState(firstIncompleteScreen);
  const [localDone, setLocalDone] = useState({
    whatsapp: status.hasWhatsApp,
    properties: status.hasProperties,
    contacts: status.hasContacts,
    emailLeads: status.hasEmailLeadSync,
  });

  const allDone =
    localDone.whatsapp &&
    localDone.properties &&
    localDone.contacts &&
    localDone.emailLeads;

  const steps: StepDef[] = [
    { id: 'whatsapp', label: 'Connect WhatsApp', done: localDone.whatsapp },
    { id: 'property', label: 'Add property', done: localDone.properties },
    { id: 'contact', label: 'Add buyers', done: localDone.contacts },
    { id: 'email-leads', label: 'Portal leads', done: localDone.emailLeads },
  ];

  function advanceStep(doneKey: keyof typeof localDone) {
    const updated = { ...localDone, [doneKey]: true };
    setLocalDone(updated);
    if (!updated.whatsapp) {
      setScreen(1);
      return;
    }
    if (!updated.properties) {
      setScreen(2);
      return;
    }
    if (!updated.contacts) {
      setScreen(3);
      return;
    }
    if (!updated.emailLeads) {
      setScreen(4);
      return;
    }
    setScreen(5);
  }

  const showChrome = !allDone && screen > 0 && screen < 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-[#0d1424] p-8 shadow-2xl">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          aria-label="Skip setup"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Back — from a tracked step to the welcome explainer */}
        {showChrome && (
          <button
            onClick={() => setScreen(0)}
            className="absolute top-4 left-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            aria-label="Back to overview"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}

        {/* Header */}
        {showChrome && (
          <div className="mt-4 mb-6">
            <div className="mb-1 text-xs text-slate-500">Getting started</div>
            <h1 className="text-lg font-bold text-white">
              Set up your ConvoReal workspace
            </h1>
          </div>
        )}

        {/* Step indicator */}
        {showChrome && <StepIndicator steps={steps} current={screen - 1} />}

        {/* Content */}
        {allDone || screen === 5 ? (
          <AllDone onClose={onDismiss} />
        ) : screen === 0 ? (
          <StepWelcome onNext={() => setScreen(firstIncompleteScreen() || 1)} />
        ) : screen === 1 ? (
          <StepWhatsApp
            done={localDone.whatsapp}
            onDone={() => advanceStep('whatsapp')}
            onRefresh={onRefresh}
          />
        ) : screen === 2 ? (
          <StepProperty
            onDone={() => advanceStep('properties')}
            onRefresh={onRefresh}
          />
        ) : screen === 3 ? (
          <StepBuyers
            onDone={() => advanceStep('contacts')}
            onRefresh={onRefresh}
          />
        ) : (
          <StepEmailLeads
            done={localDone.emailLeads}
            onDone={() => advanceStep('emailLeads')}
            onSkip={() => {
              onSkipEmailLeads();
              advanceStep('emailLeads');
            }}
            onRefresh={onRefresh}
          />
        )}

        {/* Dot navigation */}
        {showChrome && (
          <div className="mt-8 flex justify-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setScreen(i + 1)}
                className={`h-1.5 rounded-full transition-all ${
                  i + 1 === screen
                    ? 'bg-primary w-4'
                    : s.done
                      ? 'w-1.5 bg-emerald-500'
                      : 'w-1.5 bg-slate-700'
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
