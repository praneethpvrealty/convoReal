'use client';

// ============================================================
// Guided WhatsApp Business setup — /settings/whatsapp-setup.
//
// Written for a consultant who has never opened Meta's console:
// two paths — a hand-held walkthrough of every Meta screen
// (portfolio → app → number → token → paste credentials → verify),
// or a concierge form where the team does it for them.
//
// The credential step posts to /api/whatsapp/config, which verifies
// against Meta's Graph API before saving — that IS the live
// validation. The final step runs the registration probe so the
// user leaves knowing events actually flow, not just that a form
// saved. Progress persists per-account in localStorage. Each step
// carries a media slot (src/lib/onboarding/media.ts) that upgrades
// from illustration to video once one is recorded.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HeartHandshake,
  Loader2,
  MessageCircle,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StepMedia } from '@/components/onboarding/step-media';
import { MetaConsoleIllustration } from '@/components/onboarding/illustrations';
import { WhatsAppConciergeForm } from '@/components/settings/whatsapp-concierge-form';
import type { OnboardingMediaSlug } from '@/lib/onboarding/media';

type Mode = 'choose' | 'guided' | 'concierge';

interface GuideStepDef {
  slug: OnboardingMediaSlug;
  title: string;
  time: string;
  intro: string;
  link?: { href: string; label: string };
  checklist: React.ReactNode[];
  tip?: React.ReactNode;
  illustration: React.ReactNode;
}

const Strong = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-semibold text-slate-200">{children}</strong>
);

const GUIDE_STEPS: GuideStepDef[] = [
  {
    slug: 'wa-setup-portfolio',
    title: 'Create your Meta Business Portfolio',
    time: '~5 min',
    intro:
      'Everything WhatsApp-related lives inside a free Meta Business Portfolio (also called Business Manager). If you already run Facebook or Instagram ads for your business, you probably have one — skip ahead.',
    link: {
      href: 'https://business.facebook.com/overview',
      label: 'business.facebook.com/overview',
    },
    checklist: [
      <>
        Open the link above and click <Strong>Create Account</Strong>.
      </>,
      <>
        Enter your <Strong>business name</Strong>, your name, and your{' '}
        <Strong>business email</Strong>, then submit.
      </>,
      <>
        Open your email inbox and click the <Strong>verification link</Strong>{' '}
        Meta sends you.
      </>,
    ],
    tip: 'Use the business name exactly as you want buyers to see it — it appears on your WhatsApp profile later.',
    illustration: (
      <MetaConsoleIllustration
        title="business.facebook.com/overview"
        rows={[
          { label: 'Business name — Sharma Realty' },
          { label: 'Your name' },
          { label: 'Business email' },
        ]}
      />
    ),
  },
  {
    slug: 'wa-setup-app',
    title: 'Create a Meta App with WhatsApp',
    time: '~5 min',
    intro:
      "The app is the bridge between WhatsApp and ConvoReal. It sounds technical but it's four clicks — you never write any code.",
    link: {
      href: 'https://developers.facebook.com/apps',
      label: 'developers.facebook.com/apps',
    },
    checklist: [
      <>
        Open the link above and click <Strong>Create App</Strong> (top right).
      </>,
      <>
        When asked for a use case, choose{' '}
        <Strong>&quot;Connect with customers through WhatsApp&quot;</Strong> (or
        &quot;Other&quot; → &quot;Business&quot;).
      </>,
      <>
        Select the <Strong>Business Portfolio</Strong> you created in step 1.
      </>,
      <>
        Name the app after your business (e.g.{' '}
        <Strong>Sharma Realty Engine</Strong>) and create it.
      </>,
      <>
        If WhatsApp isn&apos;t already added: on the app dashboard, find{' '}
        <Strong>WhatsApp</Strong> and click <Strong>Set Up</Strong>.
      </>,
    ],
    illustration: (
      <MetaConsoleIllustration
        title="developers.facebook.com/apps"
        rows={[
          { label: 'Use case — Connect with customers through WhatsApp' },
          { label: 'Business portfolio — Sharma Realty' },
          { label: 'App name — Sharma Realty Engine' },
        ]}
      />
    ),
  },
  {
    slug: 'wa-setup-number',
    title: 'Add and verify your number',
    time: '~10 min',
    intro:
      'This is the number buyers will message. Important: the number must NOT be active in the WhatsApp app on any phone — Meta will refuse it. A fresh SIM works best; if your number is on the app today, either use a new number or delete the WhatsApp account on that phone first (your phone chats stay backed up).',
    checklist: [
      <>
        In your app&apos;s dashboard, open <Strong>WhatsApp → API Setup</Strong>{' '}
        in the left sidebar.
      </>,
      <>
        Click <Strong>Add phone number</Strong>.
      </>,
      <>
        Enter your <Strong>display name</Strong> (your business name), category,
        and description.
      </>,
      <>
        Enter the phone number — it must be able to receive an{' '}
        <Strong>SMS or voice call</Strong> right now.
      </>,
      <>
        Type in the <Strong>verification code</Strong> Meta sends to it.
      </>,
      <>
        Then set a <Strong>two-step verification PIN</Strong>: in WhatsApp
        Manager, go to <Strong>Phone numbers → Two-step verification</Strong>{' '}
        and choose a 6-digit PIN. Write it down — ConvoReal needs it in step 5.
      </>,
    ],
    tip: 'On the same API Setup page you can already see your Phone Number ID and WhatsApp Business Account ID — you copy both in step 5.',
    illustration: (
      <MetaConsoleIllustration
        title="App → WhatsApp → API Setup"
        rows={[
          { label: 'Phone number — +91 98765 43210' },
          { label: 'Phone Number ID', highlight: true },
          { label: 'WhatsApp Business Account ID', highlight: true },
        ]}
      />
    ),
  },
  {
    slug: 'wa-setup-token',
    title: 'Create your permanent access token',
    time: '~10 min',
    intro:
      "The token is the key ConvoReal uses to send and receive messages on your behalf. The one on the API Setup page expires in 24 hours, so we create a permanent one through a 'system user' — the fiddliest part of the whole setup, but the checklist below is exact.",
    link: {
      href: 'https://business.facebook.com/settings',
      label: 'business.facebook.com/settings',
    },
    checklist: [
      <>
        Open the link above, then in the left sidebar go to{' '}
        <Strong>Users → System users</Strong>.
      </>,
      <>
        Click <Strong>Add</Strong>, name it anything (e.g. &quot;engine&quot;),
        and pick <Strong>Admin</Strong> as the role.
      </>,
      <>
        Click the new system user → <Strong>Assign assets</Strong>.
      </>,
      <>
        Under <Strong>Apps</Strong>: pick your app, switch on{' '}
        <Strong>Full control</Strong>, save.
      </>,
      <>
        Under <Strong>WhatsApp accounts</Strong>: pick your WhatsApp account,
        switch on <Strong>Full control</Strong>, save.
      </>,
      <>
        Click <Strong>Generate new token</Strong> → choose your app → expiration{' '}
        <Strong>Never</Strong>.
      </>,
      <>
        Tick the boxes <Strong>whatsapp_business_messaging</Strong> and{' '}
        <Strong>whatsapp_business_management</Strong>, then generate.
      </>,
      <>
        Copy the token somewhere safe <Strong>immediately</Strong> — Meta shows
        it only once.
      </>,
    ],
    illustration: (
      <MetaConsoleIllustration
        title="Business settings → System users"
        rows={[
          { label: 'Token expiration — Never' },
          { label: 'whatsapp_business_messaging ✓' },
          { label: 'Permanent access token', highlight: true },
        ]}
      />
    ),
  },
];

const STEP_TITLES = [
  ...GUIDE_STEPS.map((s) => s.title),
  'Paste your details into ConvoReal',
  'Verify everything is live',
];

function progressKey(accountId: string) {
  return `wa_setup_progress_${accountId}`;
}

export function WhatsAppSetupWizard() {
  const { accountId } = useAuth();
  const [mode, setMode] = useState<Mode>('choose');
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!accountId || restored) return;
    // Deferred so the restore never sets state synchronously inside the
    // effect body (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(progressKey(accountId));
        if (raw) {
          const saved = JSON.parse(raw) as { mode?: Mode; step?: number };
          if (saved.mode === 'guided' || saved.mode === 'concierge')
            setMode(saved.mode);
          if (typeof saved.step === 'number') {
            setStep(Math.min(Math.max(saved.step, 0), STEP_TITLES.length - 1));
          }
        }
      } catch {
        // Corrupt progress state — start over.
      }
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [accountId, restored]);

  const persist = useCallback(
    (nextMode: Mode, nextStep: number) => {
      setMode(nextMode);
      setStep(nextStep);
      if (accountId) {
        localStorage.setItem(
          progressKey(accountId),
          JSON.stringify({ mode: nextMode, step: nextStep })
        );
      }
    },
    [accountId]
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href="/settings?tab=whatsapp"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
        >
          <ArrowLeft className="size-4" /> WhatsApp settings
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-white">
          Get your WhatsApp Business number connected
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          One-time setup, and your whole business runs through it. No coding —
          just clicking through Meta&apos;s screens, and we show you every one
          of them.
        </p>
      </div>

      {mode === 'choose' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => persist('guided', 0)}
            className="group hover:border-primary/60 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-left transition-all"
          >
            <div className="bg-primary/15 mb-3 flex size-10 items-center justify-center rounded-xl">
              <Compass className="text-primary size-5" />
            </div>
            <p className="font-bold text-white">Walk me through it</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              A step-by-step guide with pictures of every Meta screen. About 30
              minutes, at your pace — your progress is saved.
            </p>
            <p className="text-primary mt-3 inline-flex items-center gap-1 text-xs font-semibold">
              Start the guide{' '}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </p>
          </button>
          <button
            type="button"
            onClick={() => persist('concierge', 0)}
            className="group hover:border-primary/60 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-left transition-all"
          >
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-emerald-500/15">
              <HeartHandshake className="size-5 text-emerald-400" />
            </div>
            <p className="font-bold text-white">Do it for me</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Leave your details and our team sets everything up with you on a
              WhatsApp call. Free for beta accounts.
            </p>
            <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              Request setup{' '}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </p>
          </button>
        </div>
      )}

      {mode === 'concierge' && (
        <div className="space-y-3">
          <WhatsAppConciergeForm />
          <button
            type="button"
            onClick={() => persist('choose', 0)}
            className="text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            ← Actually, I&apos;ll try the guided setup myself
          </button>
        </div>
      )}

      {mode === 'guided' && (
        <GuidedSteps
          step={step}
          onStepChange={(s) => persist('guided', s)}
          onExit={() => persist('choose', 0)}
        />
      )}
    </div>
  );
}

// ── Guided path ───────────────────────────────────────────────────────────────

function GuidedSteps({
  step,
  onStepChange,
  onExit,
}: {
  step: number;
  onStepChange: (step: number) => void;
  onExit: () => void;
}) {
  const total = STEP_TITLES.length;
  const credentialsIndex = GUIDE_STEPS.length;
  const verifyIndex = GUIDE_STEPS.length + 1;

  return (
    <div className="space-y-5">
      {/* Progress rail */}
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEP_TITLES.map((title, i) => (
          <li key={title} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStepChange(i)}
              title={title}
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                i < step
                  ? 'border-emerald-600/60 bg-emerald-500/15 text-emerald-400'
                  : i === step
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500'
              }`}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </button>
            {i < total - 1 && <span className="h-px w-3 bg-slate-700" />}
          </li>
        ))}
        <li className="ml-2 text-xs text-slate-500">
          Step {step + 1} of {total}
        </li>
      </ol>

      {step < GUIDE_STEPS.length ? (
        <GuideStepCard def={GUIDE_STEPS[step]} index={step} />
      ) : step === credentialsIndex ? (
        <CredentialsStep onConnected={() => onStepChange(verifyIndex)} />
      ) : (
        <VerifyStep />
      )}

      <div className="flex items-center justify-between">
        {step > 0 ? (
          <Button
            variant="outline"
            className="gap-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => onStepChange(step - 1)}
          >
            <ArrowLeft className="size-4" /> Back
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="text-slate-500 hover:text-slate-300"
            onClick={onExit}
          >
            <ArrowLeft className="size-4" /> Choose a different path
          </Button>
        )}
        {step < credentialsIndex && (
          <Button className="gap-2" onClick={() => onStepChange(step + 1)}>
            Done — next step <ArrowRight className="size-4" />
          </Button>
        )}
        {step === credentialsIndex && (
          <Button
            variant="ghost"
            className="text-slate-500 hover:text-slate-300"
            onClick={() => onStepChange(verifyIndex)}
          >
            Skip — already saved
          </Button>
        )}
      </div>
    </div>
  );
}

function GuideStepCard({ def, index }: { def: GuideStepDef; index: number }) {
  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-white">
            {index + 1}. {def.title}
          </CardTitle>
          <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
            {def.time}
          </span>
        </div>
        <CardDescription className="leading-relaxed text-slate-400">
          {def.intro}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StepMedia slug={def.slug} title={def.title}>
          {def.illustration}
        </StepMedia>

        {def.link && (
          <a
            href={def.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
          >
            <ExternalLink className="size-4" /> Open {def.link.label}
          </a>
        )}

        <ol className="space-y-2.5">
          {def.checklist.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-sm text-slate-300"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-400">
                {i + 1}
              </span>
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>

        {def.tip && (
          <p className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
            💡 {def.tip}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 5: credentials (live-verified against Meta on save) ──────────────────

function CredentialsStep({ onConnected }: { onConnected: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!phoneNumberId.trim()) {
      toast.error(
        'Phone Number ID is required — it’s on the API Setup page (step 3).'
      );
      return;
    }
    if (!accessToken.trim()) {
      toast.error(
        'The permanent access token is required — you created it in step 4.'
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: phoneNumberId.trim(),
          waba_id: wabaId.trim() || null,
          access_token: accessToken.trim(),
          pin: pin.trim() || null,
          verify_token: null,
          catalog_id: null,
          auto_sync_catalog: false,
          integration_type: 'official_api',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error ||
            'Meta rejected those details — re-check each field against the guide.'
        );
        return;
      }
      if (data.registered === false && data.registration_error) {
        toast.error(
          `Saved, but Meta couldn't register the number: ${data.registration_error}. Check the two-step PIN and try again.`,
          { duration: 12000 }
        );
        return;
      }
      toast.success(
        data.phone_info?.verified_name
          ? `Connected — ${data.phone_info.verified_name} is live!`
          : 'Connected! Your number is registered with Meta.'
      );
      onConnected();
    } catch {
      toast.error(
        'Could not reach the server — check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <CardTitle className="text-white">
          5. Paste your details into ConvoReal
        </CardTitle>
        <CardDescription className="leading-relaxed text-slate-400">
          Copy each value from Meta into the matching box. When you press
          Connect, we check everything against Meta live — if something is wrong
          you&apos;ll be told exactly what, and nothing breaks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StepMedia
          slug="wa-setup-credentials"
          title="Paste your details into ConvoReal"
        >
          <MetaConsoleIllustration
            title="App → WhatsApp → API Setup"
            rows={[
              { label: 'Phone Number ID → first box below', highlight: true },
              {
                label: 'WhatsApp Business Account ID → second box',
                highlight: true,
              },
              {
                label: 'Your saved permanent token → third box',
                highlight: true,
              },
            ]}
          />
        </StepMedia>

        <div className="space-y-2">
          <Label className="text-slate-300">Phone Number ID</Label>
          <Input
            placeholder="Numbers only, e.g. 100234567890123"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-500">
            From <Strong>WhatsApp → API Setup</Strong> — shown right under your
            phone number.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">WhatsApp Business Account ID</Label>
          <Input
            placeholder="Numbers only, e.g. 100234567890456"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-500">
            On the same API Setup page, just below the Phone Number ID.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">Permanent access token</Label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="Starts with EAA…"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="border-slate-700 bg-slate-800 pr-10 text-white placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 transition-colors hover:text-white"
            >
              {showToken ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            The token you generated from the system user in step 4 — not the
            temporary one from the API Setup page.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">Two-step verification PIN</Label>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="The 6-digit PIN you set in step 3"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            className="border-slate-700 bg-slate-800 tracking-widest text-white placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-500">
            Without it Meta saves your details but won&apos;t deliver messages —
            the most common reason a new number stays silent.
          </p>
        </div>

        <Button onClick={save} disabled={saving} className="w-full gap-2">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Checking with Meta…
            </>
          ) : (
            <>
              <ShieldCheck className="size-4" /> Connect &amp; verify with Meta
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Step 6: verify events actually flow ───────────────────────────────────────

interface RegistrationProbe {
  live: boolean;
  checks: Record<string, boolean | null>;
  errors?: string[];
}

function VerifyStep() {
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration');
      const data = (await res.json()) as RegistrationProbe;
      setProbe(data);
      if (data.live) toast.success('All checks passed — your number is live!');
    } catch {
      toast.error('Could not reach the verification endpoint.');
    } finally {
      setProbing(false);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <CardTitle className="text-white">
          6. Verify everything is live
        </CardTitle>
        <CardDescription className="leading-relaxed text-slate-400">
          One click asks Meta directly whether your number is registered and
          delivering events to ConvoReal. Run it now — and any time messages
          seem to stop arriving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StepMedia slug="wa-setup-webhook" title="Verify your connection" />

        <Button onClick={runProbe} disabled={probing} className="w-full gap-2">
          {probing ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Asking Meta…
            </>
          ) : (
            <>
              <Zap className="size-4" /> Verify with Meta
            </>
          )}
        </Button>

        {probe && (
          <div
            className={`space-y-2 rounded-xl border p-4 ${
              probe.live
                ? 'border-emerald-700/40 bg-emerald-950/30'
                : 'border-amber-700/40 bg-amber-950/30'
            }`}
          >
            <p
              className={`flex items-center gap-2 text-sm font-semibold ${probe.live ? 'text-emerald-300' : 'text-amber-300'}`}
            >
              {probe.live ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <XCircle className="size-4" />
              )}
              {probe.live
                ? 'Your number is fully wired — send it a WhatsApp message and watch it appear in your Inbox.'
                : 'Not live yet — here’s what each check says:'}
            </p>
            <ul className="space-y-1">
              {Object.entries(probe.checks).map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center gap-1.5 text-xs text-slate-400"
                >
                  {v === true ? (
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-400" />
                  ) : v === false ? (
                    <XCircle className="size-3 shrink-0 text-red-400" />
                  ) : (
                    <span className="size-3 shrink-0 rounded-full border border-slate-600" />
                  )}
                  <code className="text-slate-300">{k}</code>
                </li>
              ))}
            </ul>
            {(probe.errors ?? []).length > 0 && (
              <ul className="space-y-0.5 pt-1 text-xs text-red-300">
                {probe.errors?.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}
            {!probe.live && (
              <p className="pt-1 text-xs leading-relaxed text-slate-400">
                Most fixes: re-check the two-step PIN in the previous step, or
                wait a minute and verify again. Still stuck? Use the{' '}
                <Strong>Do it for me</Strong> path — we&apos;ll finish it with
                you on a call.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-slate-800 pt-4">
          <Label className="text-slate-300">
            Webhook URL (only if Meta asks for one)
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={webhookUrl}
              className="border-slate-700 bg-slate-800 font-mono text-sm text-slate-300"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast.success('Webhook URL copied');
              }}
              className="shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            ConvoReal registers this automatically when you connect. You only
            need it if you configure webhooks by hand inside Meta&apos;s app
            dashboard.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-400">
          <MessageCircle className="size-4 shrink-0 text-emerald-400" />
          When the check above is green, message your business number from a
          friend&apos;s phone — it appears in your Inbox within seconds. That
          moment is the whole product working.
        </div>
      </CardContent>
    </Card>
  );
}
