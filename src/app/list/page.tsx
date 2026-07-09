import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ListPropertyForm } from '@/components/showcase/list-property-form';
import { BRANDING } from '@/config/branding';

export const metadata: Metadata = {
  title: `List your property — ${BRANDING.name}`,
  description: 'Submit your property in minutes. Paste the details, add photos, and verify on WhatsApp.',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ ref?: string; account_id?: string; agent_id?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ListPropertyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const ref = params.ref || params.account_id || params.agent_id || process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;

  let accountId: string | null = null;
  let siteName = BRANDING.name;

  if (ref && UUID_RE.test(ref)) {
    const admin = supabaseAdmin();
    const { data: account } = await admin.from('accounts').select('id').eq('id', ref).maybeSingle();
    if (account) {
      accountId = account.id as string;
      const { data: settings } = await admin
        .from('showcase_settings')
        .select('website_name')
        .eq('account_id', accountId)
        .maybeSingle();
      if (settings?.website_name) siteName = settings.website_name as string;
    }
  }

  if (!accountId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-bold">Listing link not found</h1>
          <p className="text-sm text-slate-400">
            This “list your property” link is missing or invalid. Please use the link shared by your agent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold">List your property</h1>
          <p className="text-sm text-slate-400 mt-1">
            with {siteName} — paste your details, add photos, and verify on WhatsApp.
          </p>
        </header>
        <ListPropertyForm accountId={accountId} siteName={siteName} />
      </div>
    </div>
  );
}
