import type { Metadata } from 'next';
import { MessageCircle } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ListPropertyForm } from '@/components/showcase/list-property-form';
import {
  formatRequirement,
  requirementReference,
} from '@/lib/requirements/share';
import {
  resolveRequirementLinkByToken,
  trackRequirementLinkView,
} from '@/lib/requirements/respond';
import { BRANDING } from '@/config/branding';

export const metadata: Metadata = {
  title: `Shared requirement — ${BRANDING.name}`,
  description:
    'A co-broker shared a client requirement with you. Respond with a matching listing.',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

function DeadLinkScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-bold">Requirement not available</h1>
        <p className="text-sm text-slate-400">{message}</p>
      </div>
    </div>
  );
}

export default async function RequirementSharePage({ params }: PageProps) {
  const { token } = await params;
  const admin = supabaseAdmin();

  const resolved = await resolveRequirementLinkByToken(admin, token);
  if (!resolved) {
    return (
      <DeadLinkScreen message="This shared requirement link has expired or been withdrawn. Please ask the agent who shared it for a fresh one." />
    );
  }

  const { link, requirement } = resolved;

  if (requirement.requirement_active === false) {
    return (
      <DeadLinkScreen message="This requirement is no longer active — the client may already have found a match. Thanks for taking a look!" />
    );
  }

  await trackRequirementLinkView(admin, link);

  const [{ data: account }, { data: settings }] = await Promise.all([
    admin
      .from('accounts')
      .select('id, name')
      .eq('id', link.account_id)
      .maybeSingle(),
    admin
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', link.account_id)
      .maybeSingle(),
  ]);

  const siteName = (account?.name as string) || BRANDING.name;
  const contactPhone = ((settings?.contact_phone as string) || '').replace(
    /\D/g,
    ''
  );
  const reference = requirementReference(requirement.id);

  const [heading, ...detailLines] = formatRequirement(
    requirement,
    link.mode
  ).split('\n• ');
  const whatsappText = `Hi! I'm responding to requirement ${reference} — I have a matching listing.`;
  const whatsappLink = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(whatsappText)}`
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
        <header className="text-center">
          <p className="text-xs tracking-wider text-slate-500 uppercase">
            {siteName} shared a requirement
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            Fresh requirement — take a look
          </h1>
        </header>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <p className="text-primary text-sm font-semibold">{reference}</p>
          <h2 className="mt-1 text-lg font-bold">{heading}</h2>
          <ul className="mt-3 space-y-1.5">
            {detailLines.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-slate-300">
                <span className="text-slate-600">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-bold">Have a matching listing?</h2>
          <p className="mt-1 mb-4 text-sm text-slate-400">
            Share it right here — paste the details, add photos, and verify on
            WhatsApp. {siteName} will review it against this requirement.
          </p>
          <ListPropertyForm
            accountId={link.account_id}
            siteName={siteName}
            requirementLinkToken={link.token}
            requirementReference={reference}
          />
        </div>

        {whatsappLink && (
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
            <h2 className="text-base font-bold">Prefer WhatsApp?</h2>
            <p className="text-sm text-slate-400">
              Message {siteName} quoting {reference} and share your listing in
              chat — our assistant will guide you through.
            </p>
            <a
              href={whatsappLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-500"
            >
              <MessageCircle className="size-5 fill-white text-emerald-600" />
              Respond on WhatsApp
            </a>
          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          Have more properties?{' '}
          <a
            href={`/list?ref=${link.account_id}`}
            className="text-primary hover:underline"
          >
            Share your full inventory with {siteName}
          </a>
        </p>
      </div>
    </div>
  );
}
